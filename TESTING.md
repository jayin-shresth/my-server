# CareFlow release testing

## Automated baseline

Run from the project root:

```powershell
npm.cmd test
npm.cmd run db:validate
npm.cmd run db:check
npm.cmd run typecheck
npm.cmd --prefix src/widgets run build
npm.cmd run build
```

The unified test command covers database isolation and planner boundaries,
orchestrator contracts, and Workforce Coordinator behavior. Each stateful suite
uses a temporary copy of the synthetic database and does not modify the demo
database. Run `npm.cmd run db:seed` only when you intentionally want to restore
the deterministic baseline before a demo.

## NitroStudio direct-tool results

Validated against the deterministic synthetic database:

- `analyze_staffing_gap` returned 3/4 coverage for
  `shift-icu-20260709-day` and recommended `staff-user-05`.
- `build_weekly_roster_plan` returned 42 assignments for `loc-04`, week
  `2026-07-13`, with deterministic replay and complete coverage.
- `prepare_weekly_roster` created a draft only; stale hashes were rejected.
- `prepare_staff_reassignment` created a draft only; ineligible
  `staff-user-08` was rejected for `MISSING_REQUIRED_SKILL`.
- Identical idempotency keys replayed the same action and conflicting payloads
  were rejected.
- Invalid dates and non-Monday roster dates were rejected.
- Anonymous direct calls were rejected until the explicit local demo actor was
  configured.

## Final NitroChat smoke test

1. Start `npm.cmd run dev` and connect NitroStudio to this folder.
2. Start the `careflow_orchestrator_session` prompt.
3. Ask: `Analyze shift-icu-20260709-day through CareFlow. Do not change assignments.`
4. Confirm the host calls `list_careflow_capabilities`, then
   `create_careflow_handoff`, then only the returned `analyze_staffing_gap` tool.
5. Ask explicitly to prepare `staff-user-05`; confirm a draft is returned and
   the flow stops before approval.
6. Confirm the Workforce widget labels analysis as read-only and prepared work
   as requiring authorized human approval.

## Release boundary

This release ships the Orchestrator and Workforce Coordinator vertical.
Inventory/procurement catalog entries remain unavailable until the teammate's
real tool provider is merged and registered. No forecasting, prediction, clinical
advice, self-approval, roster publication, or operational execution is exposed.
