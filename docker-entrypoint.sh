#!/bin/sh
# Container entry point: apply pending database migrations, then run the command (the API by default).
#
#   RUN_MIGRATIONS=false   skip the migration step (e.g. when the release pipeline migrates separately)
#
# Migrations take a database-wide lock, so several containers starting together are safe: one applies
# them, the others wait and find nothing left to do. A failed migration stops the container (exit 1)
# instead of starting an API that expects a schema that is not there.
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ] && [ "${1:-}" = "node" ] && [ "${2:-}" = "dist/index.js" ]; then
  echo "[entrypoint] applying database migrations"
  node dist/migrate.js
fi

exec "$@"
