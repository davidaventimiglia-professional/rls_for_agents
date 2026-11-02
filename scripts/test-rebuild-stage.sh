#!/usr/bin/env bash
# Tests for scripts/rebuild-stage.sh against the local stack (never a hosted project): tamper with the schema and
# data the way a run-through does, rebuild, and check the schema matches the migrations again while Auth (users,
# OAuth clients) and the active agent grants survive. Takes a minute or two (the verify step builds a shadow).
set -uo pipefail
cd "$(dirname "$0")/.."
script=scripts/rebuild-stage.sh
LOCAL_URL="postgresql://postgres:postgres@127.0.0.1:$(sed -n '/^\[db\]/,/^\[/s/^port *= *//p' supabase/config.toml | head -1)/postgres"
# Active grants for OAuth clients that still exist (the restore skips grants to deleted clients).
GRANTS_SQL="select coalesce(string_agg(user_id || '/' || client_id, ',' order by user_id, client_id), '') from app.agent_grants
  where revoked_at is null and client_id in (select id from auth.oauth_clients where deleted_at is null)"
# The seed's own tenants: player tenants are provisioned at play time, and a rebuild removes them.
SEED_INVOICES_SQL="select count(*) from public.invoices i join public.tenants t on t.id = i.tenant_id where t.kind in ('stage', 'victim')"
# Never read the real ~/.ar-copilot/stage.env, and ignore any STAGE_* the caller's shell has exported.
envdir="$(mktemp -d)"; trap 'rm -rf "$envdir"' EXIT
export AR_ENV_DIR="$envdir"
unset STAGE_REF STAGE_DB_PASSWORD STAGE_SEED_PASSWORD STAGE_CANARY_SALT DB_URL
STAGE_POOLER="aws-0-us-west-2.pooler.supabase.com:5432/postgres"
q() { psql "$LOCAL_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

fails=0
check() { # name, condition result (0 = pass)
  if [ "$2" -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi
}
has() { grep -qF -- "$2" <<<"$1"; }

# 1. Guards: nothing runs without --yes, and only the stage project or the local stack is a valid target.
out="$(DB_URL="$LOCAL_URL" $script 2>&1)"; rc=$?
[ $rc -ne 0 ]; check "no --yes: refuses" $?
has "$out" "--yes"; check "no --yes: says how to run it" $?
out="$(DB_URL="postgresql://postgres.otherref@aws-0-us-west-2.pooler.supabase.com:5432/postgres" STAGE_REF=stageref \
  STAGE_DB_PASSWORD=x STAGE_SEED_PASSWORD=x STAGE_CANARY_SALT=x $script --yes --no-verify 2>&1)"; rc=$?
[ $rc -ne 0 ]; check "another project: refuses" $?
has "$out" "not the stage project"; check "another project: says why" $?
out="$(DB_URL="postgresql://postgres.stageref@aws-0-us-west-2.pooler.supabase.com:5432/postgres" STAGE_REF=stageref \
  STAGE_DB_PASSWORD=x STAGE_SEED_PASSWORD= STAGE_CANARY_SALT=x $script --yes --no-verify 2>&1)"; rc=$?
[ $rc -ne 0 ]; check "stage without the seed password: refuses" $?
has "$out" "STAGE_SEED_PASSWORD"; check "stage without the seed password: names it" $?

# 1b. The scripts load ~/.ar-copilot/stage.env themselves (here AR_ENV_DIR): nothing needs exporting first.
printf 'STAGE_REF=stageref\nSTAGE_DB_PASSWORD=x\nSTAGE_SEED_PASSWORD=x\nSTAGE_CANARY_SALT=x\n' > "$envdir/stage.env"
out="$(DB_URL="postgresql://postgres.stageref@$STAGE_POOLER" $script 2>&1)"
has "$out" "Run again with --yes"; check "env file: loaded, every stage check passes (stops only at --yes)" $?
out="$(DB_URL="postgresql://postgres.otherref@$STAGE_POOLER" $script 2>&1)"
has "$out" "not the stage project"; check "env file: its STAGE_REF guards the target" $?
out="$(STAGE_SEED_PASSWORD= DB_URL="postgresql://postgres.stageref@$STAGE_POOLER" $script 2>&1)"
has "$out" "STAGE_SEED_PASSWORD"; check "env file: a value already in the environment wins (even empty)" $?
rm "$envdir/stage.env"
out="$(DB_URL="postgresql://postgres.stageref@$STAGE_POOLER" $script 2>&1)"
has "$out" "stage.env"; check "no env file and no STAGE_REF: names the file" $?

# 1c. reset-stage.sh refuses when the linked project isn't the stage project in stage.env.
printf 'STAGE_REF=notthelinkedref\nSTAGE_DB_PASSWORD=x\n' > "$envdir/stage.env"
out="$(scripts/reset-stage.sh 2>&1)"; rc=$?
[ $rc -ne 0 ]; check "reset: another linked project: refuses" $?
has "$out" "linked project is not stage"; check "reset: another linked project: says why" $?
rm "$envdir/stage.env"

# 2. What must survive the rebuild.
users_before="$(q "select count(*) from auth.users")"
clients_before="$(q "select string_agg(id::text, ',' order by id) from auth.oauth_clients")"
grants_before="$(q "$GRANTS_SQL")"
invoices_before="$(q "$SEED_INVOICES_SQL")"
[ -n "$grants_before" ]; check "setup: the local stack has active agent grants to keep" $?

# 3. Tamper like a run-through: RLS off, a read policy dropped, a rogue policy, a function gone, data changed.
q "alter table public.invoices disable row level security;
   drop policy if exists customers_read on public.customers;
   drop policy if exists rogue_read on public.payments;
   create policy rogue_read on public.payments for select to authenticated using (true);
   drop function if exists public.search_payments(boolean, timestamptz);
   update public.invoices set status = 'paid' where invoice_number = 'BWS-2026-1889';
   delete from public.payments where payer_name = 'Harbor Hardware Co';"

# 4. Rebuild (with the verify step, which diffs the local stack against the migrations).
out="$(DB_URL="$LOCAL_URL" $script --yes 2>&1)"; rc=$?
check "rebuild: exits 0" $rc
[ $rc -eq 0 ] || echo "$out" | tail -20
has "$out" "No schema changes found"; check "rebuild: the schema matches the migrations" $?
has "$out" "beat 1 today"; check "rebuild: prints beat 1's counts" $?

[ "$(q "select relrowsecurity from pg_class where oid = 'public.invoices'::regclass")" = t ]; check "invoices: RLS is on again" $?
[ "$(q "select count(*) from pg_policies where policyname = 'customers_read'")" = 1 ]; check "customers_read is back" $?
[ "$(q "select count(*) from pg_policies where policyname = 'rogue_read'")" = 0 ]; check "the rogue policy is gone" $?
[ "$(q "select count(*) from pg_proc where oid = to_regprocedure('public.search_payments(boolean, timestamptz)')")" = 1 ]
check "search_payments is back" $?
[ "$(q "select status from public.invoices where invoice_number = 'BWS-2026-1889'")" != paid ]; check "the tampered invoice is restored" $?
[ "$(q "select count(*) from public.payments where payer_name = 'Harbor Hardware Co' and remittance_memo like '%SYSTEM NOTE%'")" = 1 ]
check "the beat 2 injection payment is back" $?
[ "$(q "$SEED_INVOICES_SQL")" = "$invoices_before" ]; check "the seed's invoices are all back" $?
[ "$(q "select count(*) from auth.users")" = "$users_before" ]; check "auth users untouched" $?
[ "$(q "select string_agg(id::text, ',' order by id) from auth.oauth_clients")" = "$clients_before" ]; check "OAuth clients untouched" $?
[ "$(q "$GRANTS_SQL")" = "$grants_before" ]
check "active agent grants kept" $?
[ "$(q "select count(*) from cron.job where jobname in ('ctf-score', 'ctf-prompt-retention')")" = 2 ]; check "scorer cron jobs scheduled once each" $?
[ "$(q "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'pending_actions'")" = 1 ]
check "the inbox is in the realtime publication" $?

# 5. A failure part-way (a broken migration after the wipe) changes nothing: one transaction.
broken="$(mktemp -d)"; cp supabase/migrations/*.sql "$broken/"
echo "select 1 / 0;" > "$broken/29991231000000_broken.sql"
q "alter table public.invoices disable row level security"
out="$(DB_URL="$LOCAL_URL" REBUILD_MIGRATIONS_DIR="$broken" $script --yes --no-verify 2>&1)"; rc=$?
rm -rf "$broken"
[ $rc -ne 0 ]; check "broken migration: fails" $?
has "$out" "nothing was changed"; check "broken migration: says nothing was changed" $?
[ "$(q "select relrowsecurity from pg_class where oid = 'public.invoices'::regclass")" = f ]; check "broken migration: the database is as it was (RLS still off)" $?
[ "$(q "$SEED_INVOICES_SQL")" = "$invoices_before" ]; check "broken migration: the data is still there" $?
q "alter table public.invoices enable row level security"

[ $fails -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
