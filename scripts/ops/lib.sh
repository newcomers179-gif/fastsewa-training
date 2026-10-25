# shellcheck shell=bash
# Shared helpers for backup-db.sh and restore-db.sh (sourced, not run).

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# env_value NAME: the variable from the environment, else its line in the first .env found (current
# directory, then the repository root). The file is read as text and never executed, so a stray
# $(...) in a value cannot run anything.
env_value() {
  local name="$1" value="${!1-}" file line
  if [[ -n "$value" ]]; then printf '%s' "$value"; return 0; fi
  for file in "$PWD/.env" "$ROOT/.env"; do
    [[ -f "$file" ]] || continue
    line="$(grep -E "^${name}=" "$file" | tail -n 1 || true)"
    [[ -n "$line" ]] || continue
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    printf '%s' "$value"
    return 0
  done
  return 1
}

url_decode() {
  local s="$1"
  printf '%b' "${s//%/\\x}"
}

# export_pg_env_from_url URL: sets PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (and PGSSLMODE when the
# URL has sslmode=) for pg_dump / pg_restore / psql. The password therefore never appears on a command
# line, where `ps` would show it to every user of the machine.
export_pg_env_from_url() {
  local url="$1"
  local re='^postgres(ql)?://(([^:@/]*)(:([^@]*))?@)?(\[[^]]+\]|[^:/?#]+)(:([0-9]+))?(/([^?#]*))?(\?([^#]*))?$'
  [[ $url =~ $re ]] || return 1
  local user="${BASH_REMATCH[3]}" pass="${BASH_REMATCH[5]}" host="${BASH_REMATCH[6]}"
  local port="${BASH_REMATCH[8]}" db="${BASH_REMATCH[10]}" query="${BASH_REMATCH[12]}" pair dbname
  host="${host#[}"; host="${host%]}"
  [[ -n "$db" ]] || return 1
  dbname="$(url_decode "$db")"
  export PGHOST="$host" PGPORT="${port:-5432}" PGDATABASE="$dbname" PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
  if [[ -n "$user" ]]; then export PGUSER; PGUSER="$(url_decode "$user")"; fi
  if [[ -n "$pass" ]]; then export PGPASSWORD; PGPASSWORD="$(url_decode "$pass")"; fi
  local IFS='&'
  for pair in $query; do
    case "$pair" in
      sslmode=*) export PGSSLMODE="${pair#sslmode=}" ;;
      channel_binding=*) export PGCHANNELBINDING="${pair#channel_binding=}" ;;
    esac
  done
}

need() { command -v "$1" > /dev/null 2>&1 || die "$1 is not installed (${2:-needed by this script})"; }
