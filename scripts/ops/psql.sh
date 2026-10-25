#!/usr/bin/env bash
# Open a psql session on the production database without putting the password on a command line
# (where `ps` would show it to every user of the machine).
#
#   scripts/ops/psql.sh                       interactive session, DATABASE_URL from the environment or ./.env
#   scripts/ops/psql.sh -c 'select count(*) from users'
#
# Any arguments are passed to psql. Be careful: this is the live database.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/lib.sh
source "$ROOT/scripts/ops/lib.sh"
need psql "install the PostgreSQL client tools"
url="$(env_value DATABASE_URL)" || die "DATABASE_URL is not set (environment or .env)"
export_pg_env_from_url "$url" || die "DATABASE_URL is not a valid postgresql:// URL"
exec psql "$@"
