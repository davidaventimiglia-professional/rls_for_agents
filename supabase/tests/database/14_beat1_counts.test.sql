-- Beat 1's numbers move every day (the seed's dates are relative to the day it ran; overdue is measured against
-- today), so scripts/reset-stage.sh prints the day's counts. They must be what each person can see under RLS,
-- the same rows list_overdue_invoices returns for "more than a year overdue".
begin;
\ir _fixtures.psql
\ir _stage/beat1_counts.psql
select * from no_plan();

-- Alice (admin) sees both; Bob (rep) sees only his customer's. Plus one that's not overdue enough, one paid, and
-- one in another tenant.
insert into public.invoices (tenant_id, customer_id, invoice_number, amount, currency, issued_at, due_at, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c001', 'BWS-2026-Y1', 10, 'USD', current_date - 420, current_date - 390, 'open'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c002', 'BWS-2026-Y2', 10, 'USD', current_date - 420, current_date - 366, 'partial'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c002', 'BWS-2026-Y3', 10, 'USD', current_date - 420, current_date - 365, 'open'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c001', 'BWS-2026-Y4', 10, 'USD', current_date - 420, current_date - 390, 'paid'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000c003', 'KST-2026-Y5', 10, 'USD', current_date - 420, current_date - 390, 'open');

select is(pg_temp.beat1_count('alice@brightwater.test'), 2::bigint, 'Alice: both of her tenant''s year-overdue invoices');
select is(pg_temp.beat1_count('bob@brightwater.test'), 1::bigint, 'Bob: only his customer''s');

select pg_temp.act_as('a11ce000-0000-0000-0000-000000000001');
select is(jsonb_array_length(public.list_overdue_invoices(366) -> 'data')::bigint, 2::bigint, 'same as list_overdue_invoices(366) for Alice');
reset role;

-- Beat 1's "RLS off" step: with RLS off on invoices and customers (the tool joins both), Bob's same question returns
-- every tenant's year-overdue invoices. The reset prints that number too, so the script can say what to expect.
-- Counted once, as the owner (as the reset runs it): acting as Bob, the count itself would be under RLS.
select pg_temp.beat1_rls_off_count() as rls_off \gset
select ok(:rls_off >= pg_temp.beat1_count('alice@brightwater.test') + 1,
  'RLS off: more than Alice sees, because it includes the other tenant''s');
alter table public.invoices disable row level security;
alter table public.customers disable row level security;
select pg_temp.act_as('b0b00000-0000-0000-0000-000000000002');
select is(jsonb_array_length(public.list_overdue_invoices(366) -> 'data')::bigint, :rls_off::bigint,
  'RLS off: the same as list_overdue_invoices(366) returns for Bob');
reset role;
alter table public.invoices enable row level security;
alter table public.customers enable row level security;
select pg_temp.act_as('b0b00000-0000-0000-0000-000000000002');
select ok(jsonb_array_length(public.list_overdue_invoices(366) -> 'data')::bigint < :rls_off,
  'RLS back on: Bob sees fewer again');
reset role;

select is(current_user::text, 'postgres', 'leaves the role as it was');
select is(pg_temp.beat1_count('nobody@brightwater.test'), null::bigint, 'an unknown email gives no count');

select * from finish();
rollback;
