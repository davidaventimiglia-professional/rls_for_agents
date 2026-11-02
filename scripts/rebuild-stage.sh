#!/usr/bin/env bash
# Rebuilds stage's schema and data from the repo: removes everything the migrations and the seed create, runs every
# migration and the seed again, then resets and checks. Use it after a run-through that tampered with the database
# (RLS turned off, policies dropped or changed, functions removed); scripts/reset-stage.sh only resets the data.
#   scripts/rebuild-stage.sh --yes [--no-verify]
# One transaction: if any step fails, stage is left exactly as it was. Auth is untouched (users, the agent's OAuth
# client, consents), and the active agent grants are kept, so Alice and Bob stay connected. The seed's dates move
# to today, so beat 1's counts start over. The verify step (supabase db diff, needs Docker, about a minute) fails
# if the schema differs from the migrations at all.
# Reads STAGE_REF, STAGE_DB_PASSWORD, STAGE_SEED_PASSWORD and STAGE_CANARY_SALT from ~/.ar-copilot/stage.env itself
# (scripts/lib/stage-env.sh), and refuses unless the linked project is that STAGE_REF. DB_URL may point at the
# local stack instead (scripts/test-rebuild-stage.sh); then the seed uses its local defaults.
set -euo pipefail
cd "$(dirname "$0")/.."
SUPABASE="${SUPABASE:-npx --yes supabase@2.122.0}"
MIGRATIONS_DIR="${REBUILD_MIGRATIONS_DIR:-supabase/migrations}"  # tests point this at a copy with a broken migration
. scripts/lib/stage-env.sh
stage_env_load

yes=false verify=true
for a in "$@"; do
  case "$a" in --yes) yes=true ;; --no-verify) verify=false ;; *) echo "unknown option $a" >&2; exit 2 ;; esac
done

DB_URL="${DB_URL:-$(cat supabase/.temp/pooler-url 2>/dev/null || true)}"
[ -n "$DB_URL" ] || { echo "no database: link stage (supabase/.temp/pooler-url) or set DB_URL" >&2; exit 1; }
case "$DB_URL" in
  *@127.0.0.1:* | *@localhost:*) target=local ;;
  *)
    target=stage
    : "${STAGE_REF:?set STAGE_REF in ${AR_ENV_DIR:-~/.ar-copilot}/stage.env}"
    case "$DB_URL" in *"postgres.$STAGE_REF@"* | *"db.$STAGE_REF."*) ;;
      *) echo "refusing: DB_URL is not the stage project" >&2; exit 1 ;; esac
    : "${STAGE_DB_PASSWORD:?set STAGE_DB_PASSWORD}"
    [ -n "${STAGE_SEED_PASSWORD:-}" ] || { echo "refusing: set STAGE_SEED_PASSWORD (the seed would use its local default)" >&2; exit 1; }
    [ -n "${STAGE_CANARY_SALT:-}" ] || { echo "refusing: set STAGE_CANARY_SALT (the seed would use its local default)" >&2; exit 1; }
    ;;
esac

if ! $yes; then
  echo "This drops and rebuilds stage's app, ctf and public objects from supabase/migrations and the seed."
  echo "Auth (users, OAuth clients, consents) and active agent grants are kept. Run again with --yes to do it."
  exit 1
fi
# The verify step diffs the linked project, so the link must be stage too.
if [ "$target" = stage ]; then stage_require_linked || exit 1; fi

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# Secrets go to psql in a file only this user can read, never on a command line.
( umask 077
  { echo "set statement_timeout = 0;"
    if [ "$target" = stage ]; then
      printf "set app.seed_password = '%s';\n" "${STAGE_SEED_PASSWORD//\'/\'\'}"
      printf "set app.canary_salt = '%s';\n" "${STAGE_CANARY_SALT//\'/\'\'}"
    fi
  } > "$work/settings.sql" )

files=(-f "$work/settings.sql" -f supabase/stage/rebuild_wipe.sql)
for m in "$MIGRATIONS_DIR"/*.sql; do files+=(-f "$m"); done
files+=(-f supabase/seed/seed.sql -f supabase/stage/rebuild_restore.sql)

echo "rebuild-stage: rebuilding $target from $(ls "$MIGRATIONS_DIR"/*.sql | wc -l | tr -d ' ') migrations and the seed..."
start=$(date +%s)
PGPASSWORD="${STAGE_DB_PASSWORD:-postgres}" psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction "${files[@]}" > "$work/psql.log" 2>&1 || {
  grep -v '^NOTICE\|^psql:.*NOTICE' "$work/psql.log" | tail -20 >&2
  echo "rebuild-stage: failed; nothing was changed (one transaction)" >&2
  exit 1
}
echo "rebuild-stage: rebuilt in $(( $(date +%s) - start )) s"

DB_URL="$DB_URL" STAGE_DB_PASSWORD="${STAGE_DB_PASSWORD:-postgres}" scripts/reset-stage.sh

if $verify; then
  echo "rebuild-stage: checking the schema against the migrations..."
  if [ "$target" = local ]; then where=(--local); else where=(--linked); fi
  diff_out="$(SUPABASE_DB_PASSWORD="${STAGE_DB_PASSWORD:-postgres}" $SUPABASE db diff "${where[@]}" --schema public,app,ctf < /dev/null 2>&1)" || {
    echo "$diff_out" | tail -20 >&2; echo "rebuild-stage: the schema check could not run" >&2; exit 1; }
  if grep -q "No schema changes found" <<<"$diff_out"; then
    echo "rebuild-stage: No schema changes found (stage matches supabase/migrations)"
  else
    echo "$diff_out" | grep -v '^Applying migration\|^Creating shadow\|^Initialising\|^Seeding globals' >&2
    echo "rebuild-stage: the schema differs from the migrations (above)" >&2
    exit 1
  fi
fi
