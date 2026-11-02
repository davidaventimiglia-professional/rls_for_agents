#!/usr/bin/env bash
# S9: restore stage to its pre-demo state (under 60 s, idempotent). Run before every rehearsal.
# Reads STAGE_REF and STAGE_DB_PASSWORD from ~/.ar-copilot/stage.env itself (scripts/lib/stage-env.sh) and refuses
# unless the linked project is that STAGE_REF. A caller that passes DB_URL (scripts/rebuild-stage.sh) has checked it.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/stage-env.sh
stage_env_load
if [ -z "${DB_URL:-}" ]; then
  stage_require_linked || exit 1
  DB_URL="$(cat supabase/.temp/pooler-url)"
fi
: "${STAGE_DB_PASSWORD:?set STAGE_DB_PASSWORD in ${AR_ENV_DIR:-~/.ar-copilot}/stage.env}"
start=$(date +%s.%N 2>/dev/null || python3 -c 'import time;print(time.time())')
PGPASSWORD="$STAGE_DB_PASSWORD" psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f supabase/stage/reset_stage.sql
end=$(python3 -c 'import time;print(time.time())')
printf 'reset-stage: done in %.1f s\n' "$(python3 -c "print($end - $start)")"
# Beat 1's counts move every day; the demo script reads them from here.
PGPASSWORD="$STAGE_DB_PASSWORD" psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f supabase/stage/beat1_counts.sql \
  -c "select format('beat 1 today (more than a year overdue): Alice %s, Bob %s',
        pg_temp.beat1_count('alice@brightwater.example'), pg_temp.beat1_count('bob@brightwater.example'))"
