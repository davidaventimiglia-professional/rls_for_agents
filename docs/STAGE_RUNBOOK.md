# Stage runbook

How to run the five stage beats (`docs/context-packs/00_SHARED_CONTEXT.md` section 11) on the stage project.
Secrets and the project ref live in `~/.ar-copilot/stage.env`, never in this repo. The stage scripts read that file
themselves, so there's nothing to export first, and they refuse unless the repo's linked project is its `STAGE_REF`.

## Before every rehearsal

1. **Reset stage** (under 60 s, idempotent):
   ```sh
   scripts/reset-stage.sh
   ```
   This drops the live $500 policy, turns the kill switch off (`docs/ARENA_RUNBOOK.md`), removes proposals and dunning emails, restores invoice statuses and
   payment matches, and gives Alice and Bob a fresh agent grant (registered clients only; the revoked grant
   and its activity stay in history on the Agent access page). It cannot restore OAuth consents, and beat 5
   revoked Alice's. Last, it prints the day's beat 1 counts (`beat 1 today (more than a year overdue): Alice N,
   Bob M`). Use those numbers: they grow by a few every day, because the seed's dates are relative to the day it
   ran and overdue is measured against today.
2. **Reconnect the agent for Alice and for Bob**, each in their own browser profile or private window. A window
   that still holds Alice's session sends Bob's consent through as Alice, and it fails. Keep the two windows
   separate for the whole demo. Sign in to the AR app at `/agent?stage=1` (or click
   **Projector mode** in the top bar, or press Alt+Shift+P; it stays on for that browser tab), click
   **Connect agent**, and approve the consent screen. After a rehearsal the page may already show the grant
   as active; reconnect anyway, because the OAuth consent behind it is gone and the agent's next token
   refresh would fail mid-demo. If the agent still holds a working token, Connect says so; if the database
   grant is missing, Connect goes back through the consent screen on its own.
3. **Warm the runtime.** Ask one harmless question in the copilot (for example, the overdue invoices over
   a year old). The first runtime call includes a cold start of about 3 s (spike).
4. **Check the inbox is live.** Approvals shows a green "live" tag next to the subtitle.

## During the talk

- **Beat 1 (same question, different answers).** Alice and Bob each ask "How many invoices are more than a year
  overdue?" The answers are the counts the reset printed, not fixed numbers.
- **Beat 1, "RLS off".** Turn RLS off on both tables the overdue tool reads (it joins invoices to customers, so
  turning off only invoices changes nothing for Bob), and Bob asks the same question again:
  ```sql
  alter table public.invoices disable row level security; alter table public.customers disable row level security;
  ```
  His answer becomes the reset's "Bob after RLS off" number, including other companies' invoices (`KST-`, `TPL-`).
  Then put it back:
  ```sql
  alter table public.invoices enable row level security; alter table public.customers enable row level security;
  ```
  Turning off RLS on payments instead doesn't work on stage: the payment search has no customer filter and returns
  the newest 200, so the agent reports "no payments found" even though other tenants' payments leaked. If a
  run-through leaves RLS off, `scripts/rebuild-stage.sh --yes` restores it.
- **Beat 4 (live policy).** The operator runs `supabase/stage/live_policy_500.sql` against stage (psql via
  the session pooler, as `scripts/reset-stage.sh` does). The reset removes it.
- **Beat 5 (revoke).** Alice clicks **Revoke agent access** on the Agent access page. It reports both halves:
  the database grant (the agent's next call is refused) and the OAuth consent. To re-grant, she clicks
  **Connect agent** on the same page and approves the consent screen again.

## After

Run the reset again (step 1). Leave reconnecting to the next rehearsal's checklist.

## After tampering with the schema: rebuild

The reset only resets data. If a run-through changed the database itself (RLS turned off, a policy dropped,
changed or added, a function removed), rebuild stage from the repo instead:
```sh
scripts/rebuild-stage.sh --yes
```
It removes the `app` and `ctf` schemas and everything the migrations put in `public`, runs every migration and the
seed again (with stage's seed password and canary salt), then runs the reset and prints beat 1's counts. Last, it
checks the schema against the migrations (`supabase db diff`, needs Docker, about a minute; skip with
`--no-verify`) and fails if anything differs.
- **One transaction.** If any step fails, stage is left exactly as it was.
- **Kept:** Auth (users and their passwords, the agent's OAuth client, consents) and the active agent grants, so
  Alice and Bob stay connected. Roles (`grafana_reader`), function secrets and Auth settings aren't touched.
- **Starts over:** the seed's dates move to the day of the rebuild, so beat 1's counts go back to the seed's
  baseline (Alice 21, Bob 4) and grow from there. Stage's recorded prompts, scores and arena players are removed
  (players are provisioned again when they next play).

Tested against the local stack by `scripts/test-rebuild-stage.sh`, including a broken migration part-way through.

## Rehearsing locally

`scripts/e2e-apps.sh copilot` runs all five beats in stage mode against the local stack with the scripted dev
agent (`scripts/dev-agent.ts --model scripted`), including the reset and reconnect steps above.
