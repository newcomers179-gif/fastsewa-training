#!/usr/bin/env bash
# Back up the FastSewa database.
#
#   scripts/ops/backup-db.sh               dump the database named by DATABASE_URL (environment, else ./.env)
#   scripts/ops/backup-db.sh --compose     dump the "db" container of docker-compose.yml (the local-db profile)
#
# Output: $BACKUP_DIR/fastsewa-<UTC time>.dump (pg_dump custom format: compressed, restorable table by
# table), mode 600, with a .sha256 next to it. Older backups are deleted after the new one has been
# written and checked, never before.
#
#   BACKUP_DIR              where to write (default: ./backups)
#   BACKUP_KEEP_DAYS        delete backups older than this many days (default 14; 0 keeps everything)
#   BACKUP_PASSPHRASE_FILE  a file holding a passphrase: the dump is then encrypted (AES-256, PBKDF2) and
#                           written as .dump.enc. Keep the passphrase somewhere other than the backups.
#   BACKUP_AFTER_COMMAND    run after a good backup with the file as $1, e.g. 'rclone copy "$1" remote:fastsewa/'
#                           or 'aws s3 cp "$1" s3://my-bucket/fastsewa/'. A failing command fails the backup.
#
# A backup holds every learner's personal data: keep it on an encrypted disk or bucket, restrict who can
# read it, and apply the retention rule in docs/DPDP-CHECKLIST.md. Use pg_dump from PostgreSQL 16 or newer
# (it refuses to dump a server newer than itself). Schedule it, for example from cron:
#   17 2 * * *  cd /opt/fastsewa && scripts/ops/backup-db.sh >> /var/log/fastsewa-backup.log 2>&1
# and rehearse a restore every month (docs/RUNBOOK.md).
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/lib.sh
source "$ROOT/scripts/ops/lib.sh"

mode=url
for arg in "$@"; do
  case "$arg" in
    --compose) mode=compose ;;
    -h | --help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP_DAYS must be a whole number of days"
passphrase_file="${BACKUP_PASSPHRASE_FILE:-}"
if [[ -n "$passphrase_file" ]]; then
  [[ -s "$passphrase_file" ]] || die "BACKUP_PASSPHRASE_FILE $passphrase_file is missing or empty"
  need openssl "needed to encrypt the backup"
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$BACKUP_DIR/.fastsewa-$stamp.partial"
trap 'rm -f "$partial" "$partial.enc"' EXIT

if [[ "$mode" == compose ]]; then
  need docker "needed for --compose"
  log "dumping the compose db container"
  # The single quotes are intended: the variables are expanded inside the container.
  # shellcheck disable=SC2016
  docker compose -f "$ROOT/docker-compose.yml" --profile local-db exec -T db \
    sh -c 'exec pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$partial"
else
  need pg_dump "install the PostgreSQL 16 client tools"
  url="$(env_value DATABASE_URL)" || die "DATABASE_URL is not set (environment or .env)"
  export_pg_env_from_url "$url" || die "DATABASE_URL is not a valid postgresql:// URL"
  log "dumping database '$PGDATABASE' on $PGHOST:$PGPORT"
  pg_dump --format=custom --file="$partial"
fi

[[ -s "$partial" ]] || die "the dump is empty"
if command -v pg_restore > /dev/null 2>&1; then
  pg_restore --list "$partial" > /dev/null || die "the dump cannot be read back (pg_restore --list failed)"
else
  log "warning: pg_restore is not installed, so the dump was not read back"
fi

if [[ -n "$passphrase_file" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$passphrase_file" -in "$partial" -out "$partial.enc"
  mv "$partial.enc" "$partial"
  final="$BACKUP_DIR/fastsewa-$stamp.dump.enc"
else
  final="$BACKUP_DIR/fastsewa-$stamp.dump"
fi
mv "$partial" "$final"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256")
chmod 600 "$final" "$final.sha256"
log "backup written: $final ($(du -h "$final" | cut -f1))"

if [[ -n "${BACKUP_AFTER_COMMAND:-}" ]]; then
  log "running BACKUP_AFTER_COMMAND"
  bash -c "$BACKUP_AFTER_COMMAND" backup-after-command "$final" || die "BACKUP_AFTER_COMMAND failed (the backup itself is at $final)"
fi

if [[ "$KEEP_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'fastsewa-*.dump' -o -name 'fastsewa-*.dump.enc' -o -name 'fastsewa-*.sha256' \) -mtime "+$KEEP_DAYS" -print -delete |
    while read -r old; do log "deleted old backup: $old"; done
fi
log "backup ok"
