# Sourced by scripts/reset-stage.sh and scripts/rebuild-stage.sh. Loads stage's settings from
# ~/.ar-copilot/stage.env (override the folder with AR_ENV_DIR), so nothing has to be exported first. A variable
# already in the environment wins, even when empty (the tests rely on that).
stage_env_load() {
  local f="${AR_ENV_DIR:-$HOME/.ar-copilot}/stage.env" k v
  [ -f "$f" ] || return 0
  for k in STAGE_REF STAGE_DB_PASSWORD STAGE_SEED_PASSWORD STAGE_CANARY_SALT; do
    [ -n "${!k+set}" ] && continue
    v="$(set -a; . "$f" >/dev/null 2>&1; printf '%s' "${!k-}")"
    [ -n "$v" ] && export "$k=$v"
  done
  return 0
}

# The repo's linked project (supabase/.temp/project-ref, written by `supabase link`) must be STAGE_REF from
# stage.env: two independent sources, so a link to any other project (the arena) is refused.
stage_require_linked() {
  local linked
  linked="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
  [ -n "${STAGE_REF:-}" ] || { echo "refusing: set STAGE_REF in ${AR_ENV_DIR:-$HOME/.ar-copilot}/stage.env" >&2; return 1; }
  [ "$linked" = "$STAGE_REF" ] || { echo "refusing: the linked project is not stage (STAGE_REF in stage.env)" >&2; return 1; }
}
