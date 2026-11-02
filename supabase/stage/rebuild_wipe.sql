-- First step of scripts/rebuild-stage.sh: remove everything the migrations and the seed create, so they can run
-- again from scratch. Runs inside the rebuild's single transaction, so a failure anywhere leaves stage as it was.
--
-- Removed: the app and ctf schemas, and every object in public that isn't an extension's. The public schema itself
-- stays, because Supabase's default grants (anon, authenticated, service_role) live on it. Untouched: auth (users,
-- OAuth clients, consents), roles (grafana_reader and its password), extensions, storage and realtime.
--
-- The seed creates no agent grants (users grant through the app), so the active ones are kept in a temp table and
-- put back by rebuild_restore.sql: Alice's and Bob's agents keep working without a new consent.

create temp table rebuild_kept_grants on commit drop as
  select user_id, client_id, granted_at from app.agent_grants where revoked_at is null;

drop schema if exists ctf cascade;
drop schema if exists app cascade;

do $$
declare r record;
begin
  -- Names are captured before anything is dropped: a cascade can remove a later entry, hence "if exists".
  for r in
    select format('drop %s if exists %I.%I cascade',
                  case c.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table'
                                 when 'S' then 'sequence' else 'table' end,
                  n.nspname, c.relname) as stmt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
    order by c.relkind = 'S'  -- sequences last: most belong to a table and go with it
  loop
    execute r.stmt;
  end loop;

  for r in
    select format('drop %s if exists %s cascade', case p.prokind when 'a' then 'aggregate' else 'routine' end,
                  p.oid::regprocedure) as stmt
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute r.stmt;
  end loop;

  for r in
    select format('drop type if exists %I.%I cascade', 'public', t.typname) as stmt
    from pg_type t
    where t.typnamespace = 'public'::regnamespace
      and (t.typtype in ('e', 'd') or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c'))
      and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')
  loop
    execute r.stmt;
  end loop;
end $$;
