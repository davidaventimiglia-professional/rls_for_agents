-- LIVE STAGE BEAT 1, "RLS off". Not a migration: run on stage during the talk (SQL editor, or psql like
-- live_policy_500.sql), then run rls_off_revert.sql. The reset turns it back on too.
-- Turns off Row Level Security on the three tables Bob's beat 1 questions read:
--   payments: "Show me the payments for Highland Outfitters Group" (not his customer) now finds them;
--   invoices and customers: "How many invoices are more than a year overdue?" (list_overdue_invoices joins both)
--   now returns every tenant's, the "Bob after RLS off" number scripts/reset-stage.sh prints.
alter table public.payments disable row level security;
alter table public.invoices disable row level security;
alter table public.customers disable row level security;
