-- LIVE STAGE BEAT 1, "RLS off". Not a migration: run on stage during the talk (SQL editor, or psql like
-- live_policy_500.sql), then run rls_off_revert.sql. Turns off Row Level Security on the two tables Bob's overdue
-- question reads (list_overdue_invoices joins invoices to customers, so both). Bob then gets every tenant's
-- year-overdue invoices: the "Bob after RLS off" number scripts/reset-stage.sh prints. The reset turns it back on.
alter table public.invoices disable row level security;
alter table public.customers disable row level security;
