-- Restores baseline after beat 1's "RLS off": Row Level Security back on for payments, invoices and customers.
alter table public.payments enable row level security;
alter table public.invoices enable row level security;
alter table public.customers enable row level security;
