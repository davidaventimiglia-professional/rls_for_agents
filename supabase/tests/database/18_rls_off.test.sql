-- Beat 1's "RLS off" step (supabase/stage/rls_off.sql) and its revert: the exact files run on stage. Off, Bob's
-- "more than a year overdue" question returns every tenant's invoices, the number the reset prints; reverted, his own.
begin;
\ir _fixtures.psql
\ir _stage/beat1_counts.psql
select * from no_plan();

insert into public.invoices (tenant_id, customer_id, invoice_number, amount, currency, issued_at, due_at, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c002', 'BWS-2026-Z1', 10, 'USD', current_date - 420, current_date - 390, 'open'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c001', 'BWS-2026-Z2', 10, 'USD', current_date - 420, current_date - 390, 'open'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000c003', 'KST-2026-Z3', 10, 'USD', current_date - 420, current_date - 390, 'open');

create function pg_temp.bob_overdue() returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.act_as('b0b00000-0000-0000-0000-000000000002');
  n := jsonb_array_length(public.list_overdue_invoices(366) -> 'data');
  reset role;
  return n;
end $$;
create function pg_temp.rls(t text) returns boolean language sql as $$ select relrowsecurity from pg_class where oid = t::regclass $$;

select pg_temp.bob_overdue() as bob_own \gset
select pg_temp.beat1_rls_off_count() as rls_off \gset
select ok(:bob_own < :rls_off, 'before: Bob sees fewer than the RLS-off number');

\ir _stage/rls_off.psql
\ir _stage/rls_off.psql
select ok(not pg_temp.rls('public.invoices') and not pg_temp.rls('public.customers'), 'rls_off.sql: RLS off on invoices and customers (twice is fine)');
select ok(pg_temp.rls('public.payments'), 'rls_off.sql: payments untouched');
select is(pg_temp.bob_overdue(), :rls_off::bigint, 'RLS off: Bob''s question returns the number the reset prints');
select pg_temp.act_as('b0b00000-0000-0000-0000-000000000002');
select ok(exists (select 1 from jsonb_array_elements(public.list_overdue_invoices(366) -> 'data') e
                  where e ->> 'invoice_number' = 'KST-2026-Z3'), 'RLS off: including another tenant''s invoice');
reset role;

\ir _stage/rls_off_revert.psql
\ir _stage/rls_off_revert.psql
select ok(pg_temp.rls('public.invoices') and pg_temp.rls('public.customers'), 'rls_off_revert.sql: RLS back on (twice is fine)');
select is(pg_temp.bob_overdue(), :bob_own::bigint, 'reverted: Bob sees his own again');

select * from finish();
rollback;
