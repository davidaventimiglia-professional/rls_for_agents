-- #4: cap the stored prompt at 16,000 characters. The agent proxy records each message as it forwards it, before the
-- runtime's own limits apply, so without a cap a scripted player could send very large messages in a loop and grow
-- ctf.prompts without limit. No real prompt comes near the cap, and the classifier only reads the first 4,000
-- characters. Same definition as before otherwise (owner, grants and search_path unchanged).
create or replace function ctf.record_prompt(p_user uuid, p_session text, p_prompt text) returns void
  language sql security definer set search_path = '' as $$
  insert into ctf.prompts (user_id, session_id, prompt) values (p_user, left(p_session, 128), left(p_prompt, 16000));
  insert into ctf.events (tenant_id, user_id, session_id, kind, detail)
  values ((select tenant_id from ctf.players where user_id = p_user), p_user, left(p_session, 128), 'prompt', '{}');
$$;
