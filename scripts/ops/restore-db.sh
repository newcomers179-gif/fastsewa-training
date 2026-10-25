#!/usr/bin/env bash
# Restore a backup made by backup-db.sh.
#
#   scripts/ops/restore-db.sh <backup file> --target-url postgresql://user:password@host:5432/dbname
#   scripts/ops/restore-db.sh <backup file> --compose            into the compose "db" container's database
#   ... --clean --yes     drop what is in the target first (needed to restore over a database that has tables)
#
# By default it only restores into an EMPTY database, so a restore rehearsal can never overwrite live
# data by accident. RESTORE_DATABASE_URL can replace --target-url (keeps the password out of your shell
# history). For an encrypted backup (.dump.enc) set BACKUP_PASSPHRASE_FILE. The checksum next to the
# backup is verified first. Use pg_restore from PostgreSQL 16 or newer.
#
# After a restore the database already contains the migration history, so the API starts against it
# without migrating. Rehearse the whole thing every month (docs/RUNBOOK.md).
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/lib.sh
source "$ROOT/scripts/ops/lib.sh"

backup="" target_url="${RESTORE_DATABASE_URL:-}" mode=url clean=no yes=no
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-url) [[ $# -ge 2 ]] || die "--target-url needs a value"; target_url="$2"; shift ;;
    --compose) mode=compose ;;
    --clean) clean=yes ;;
    --yes) yes=yes ;;
    -h | --help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1 (try --help)" ;;
    *) [[ -z "$backup" ]] || die "only one backup file can be restored at a time"; backup="$1" ;;
  esac
  shift
done

[[ -n "$backup" ]] || die "give the backup file to restore (try --help)"
[[ -f "$backup" ]] || die "no such file: $backup"
if [[ "$clean" == yes && "$yes" != yes ]]; then
  die "--clean deletes what is in the target database first; add --yes if that is what you want"
fi

# 1. integrity
if [[ -f "$backup.sha256" ]]; then
  (cd "$(dirname "$backup")" && sha256sum --check --status "$(basename "$backup").sha256") ||
    die "the checksum does not match: the backup is damaged or has been changed. Do not restore it."
  log "checksum ok"
else
  log "warning: no $(basename "$backup").sha256 next to the backup, integrity not verified"
fi

# 2. decrypt (to a private temporary file that is always removed)
dump="$backup"
tmpdir=""
cleanup() { [[ -z "$tmpdir" ]] || rm -rf "$tmpdir"; }
trap cleanup EXIT
if [[ "$backup" == *.enc ]]; then
  need openssl "needed to decrypt the backup"
  [[ -n "${BACKUP_PASSPHRASE_FILE:-}" && -s "$BACKUP_PASSPHRASE_FILE" ]] || die "this backup is encrypted: set BACKUP_PASSPHRASE_FILE to the passphrase file"
  tmpdir="$(mktemp -d)"
  dump="$tmpdir/restore.dump"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$backup" -out "$dump" ||
    die "decryption failed (wrong passphrase or damaged file)"
fi

# 3. run pg_restore / psql either on this machine or inside the compose db container
if [[ "$mode" == compose ]]; then
  need docker "needed for --compose"
  dc=(docker compose -f "$ROOT/docker-compose.yml" --profile local-db exec -T db)
  # The single quotes are intended: $POSTGRES_USER and $POSTGRES_DB must be expanded inside the container.
  # shellcheck disable=SC2016
  psql_target() { "${dc[@]}" sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"' sh "$@"; }
  # shellcheck disable=SC2016
  restore_target() { "${dc[@]}" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@" < "$dump"; }
  where="the compose db container"
else
  need pg_restore "install the PostgreSQL 16 client tools"
  need psql "install the PostgreSQL 16 client tools"
  [[ -n "$target_url" ]] || die "say where to restore: --target-url postgresql://... (or RESTORE_DATABASE_URL), or --compose"
  export_pg_env_from_url "$target_url" || die "the target is not a valid postgresql:// URL"
  psql_target() { psql -v ON_ERROR_STOP=1 "$@"; }
  restore_target() { pg_restore --dbname="$PGDATABASE" "$@" "$dump"; } # pg_restore needs -d spelled out; the host and login come from PG* variables
  where="database '$PGDATABASE' on $PGHOST:$PGPORT"
fi

psql_target -Atq -c 'select 1' > /dev/null || die "cannot connect to $where"

tables="$(psql_target -Atq -c "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
if [[ "$tables" != 0 && "$clean" != yes ]]; then
  die "$where already has $tables tables. Restore into an empty database, or add --clean --yes to replace its contents."
fi

args=(--no-owner --no-privileges --exit-on-error --single-transaction)
[[ "$clean" == yes ]] && args+=(--clean --if-exists)
log "restoring $(basename "$backup") into $where"
restore_target "${args[@]}"

log "restored. Rows per table:"
psql_target -Atq -F ' : ' -c "
  select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" |
  while IFS= read -r line; do printf '    %s\n' "$line"; done
log "restore ok"
