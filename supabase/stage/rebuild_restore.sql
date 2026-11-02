-- Last step of scripts/rebuild-stage.sh, after the migrations and the seed: put back the agent grants that were
-- active before the rebuild (kept by rebuild_wipe.sql), for users and OAuth clients that still exist.
insert into app.agent_grants (user_id, client_id, granted_at)
select k.user_id, k.client_id, k.granted_at
from rebuild_kept_grants k
where exists (select 1 from auth.users u where u.id = k.user_id)
  and exists (select 1 from auth.oauth_clients c where c.id = k.client_id and c.deleted_at is null);
