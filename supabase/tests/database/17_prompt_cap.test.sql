-- #4: the stored prompt is capped at 16,000 characters. The proxy records each message before the runtime sees it
-- (so the runtime's limits don't bound what is stored), and a scripted player could otherwise send very large
-- messages in a loop and grow ctf.prompts without limit. No real prompt comes near the cap, and the classifier
-- only reads the first 4,000 characters anyway.
begin;
\ir _fixtures.psql
select * from no_plan();

set local role service_role;
select public.record_prompt('a11ce000-0000-0000-0000-000000000001', 's-cap-at', repeat('a', 16000));
select public.record_prompt('a11ce000-0000-0000-0000-000000000001', 's-cap-over', repeat('b', 16001));
select public.record_prompt('a11ce000-0000-0000-0000-000000000001', 's-cap-huge', repeat('c', 1000000));
reset role;

select is((select length(prompt) from ctf.prompts where session_id = 's-cap-at'), 16000, 'a 16,000-character prompt is stored whole');
select is((select length(prompt) from ctf.prompts where session_id = 's-cap-over'), 16000, 'one character over is cut to 16,000');
select is((select length(prompt) from ctf.prompts where session_id = 's-cap-huge'), 16000, 'a 1,000,000-character prompt is cut to 16,000');
select is((select prompt from ctf.prompts where session_id = 's-cap-over'), repeat('b', 16000), 'the start is kept');
select is((select count(*) from ctf.events where kind = 'prompt' and session_id like 's-cap-%'), 3::bigint, 'each still counts as one prompt');

select * from finish();
rollback;
