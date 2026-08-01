# CareFlow Logistics database foundation

CareFlow uses Prisma ORM 7.9.1, SQLite, TypeScript, and Prisma's
`better-sqlite3` adapter. All records are fictional. The seed is deterministic,
uses the fixed reference time `2026-07-01T00:00:00.000Z` and seed `24072026`,
and is safe to rerun because stable IDs are upserted or inserted only when
missing.

## Architecture

- `prisma/schema.prisma` defines the normalized operational and audit model.
- `prisma/migrations` contains the versioned SQLite DDL.
- `src/generated/prisma` is generated code and must not be edited manually.
- `src/data/client.ts` is the single adapter-backed Prisma client boundary.
- `src/data/seed` contains phased, strongly typed deterministic generators.
- `src/data/queries.ts` contains application-neutral read models suitable for
  later NitroStack resources.
- `src/data/validation/validate.ts` independently recomputes balances and
  scenario arithmetic.
- `data/careflow.db` is the ignored local runtime database.

The seed phases create core organisation data, the catalogue, suppliers,
inventory history, materialized balances, and linked scenarios. Phase result
interfaces make dependencies explicit. Existing rows outside the stable
CareFlow namespace are not deleted.

## Event-sourced inventory

`InventoryTransaction` is the business header and
`InventoryLedgerEntry` is the immutable source of truth. Each ledger entry is a
signed integer movement against an exact position dimension:

`item + location + batch/serial + stock status + ownership + reservation key`

`positionKey` is the deterministic concatenation of those dimensions.
`StockPosition` is a materialized projection rebuilt from ledger sums for fast
reads; application code must never treat direct balance changes as inventory
events. Status changes such as quarantine use equal negative and positive
ledger movements. Transfers use distinct source and destination movements when
executed.

Physical quantities are integer base units. Money is integer Indian paise and
GST is integer basis points. Tracking mode (`BATCH`, `SERIAL`) is separate from
storage requirements and cold-chain evidence. Important operational and audit
history uses restricted deletion semantics.

## Demonstration scenarios

1. **ICU shortage and redistribution** — requirement `REQ-ICU-2026-001` needs
   120 units. ICU has 20 eligible units, Central can safely transfer 45, and
   Pharmacy can safely transfer 25. Internal fulfilment is 90 and the residual
   procurement gap is 30. The query excludes 50 quarantined units, 15 reserved
   units, 10 expired units, and 70 safety-stock-protected units. FEFO selects
   `batch-icu-near`.
2. **Procurement and quote comparison** — the 30-unit gap traces through a
   procurement need and RFQ line to four quotes. Price, lead time, full
   availability, compliance, and prior performance are stored independently.
   The fastest compliant full-quantity offer is recommended, approved, and
   executed into `PO-ICU-2026-001` for 163,500 paise before GST and 183,120
   paise total.
3. **Recall and quarantine** — a confirmed recall and a probable investigation
   affect batches at Central, Pharmacy, ICU-related storage, and Ward A. Prior
   issue history is retained, quarantine locations reconcile to stock
   positions, and the status changes are immutable ledger events.
4. **Receiving discrepancy** — `PO-GR-2026-001` orders 100 units; 92 arrive, 80
   are accepted, 12 rejected, and 8 are short. Damage (5), low remaining shelf
   life (4), and cold-chain evidence failure (3) reconcile to the rejected 12.
5. **Asset allocation** — 40 assets include idle, actively allocated,
   maintenance-overdue, quarantined, and unavailable states. Every in-use asset
   has one active allocation; the overdue example has a failed execution rather
   than an inconsistent allocation.
6. **Linen logistics** — a 200-piece flow records clean issue to Ward A, soiled
   return, laundering, and five rejected/lost pieces while conserving physical
   quantity.
7. **Medical oxygen** — 42 cylinders are represented as 28 full at the gas
   store, seven full allocated to ICU, five empty returns, and two on safety
   hold. This is operational status tracking, not a clinical prediction.

## Workflows and approvals

Prepared actions can be requested by `USER`, `AGENT`, or `SYSTEM` actors. They
retain payload, evidence, and reasoning metadata, then link to a tiered approval
policy. Approval requests and human decisions are separate from executions.
The seed includes successful, pending, rejected, and failed examples. An action
cannot have an execution unless its approval request has an approving human
decision; the validation command enforces this and verifies that every purchase
order has a successful approved execution.

## Commands

From the repository root:

```powershell
npm run db:validate
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run db:check
npm run typecheck
npm run build
```

Use `npm run db:inspect` to open Prisma Studio. During schema development use
`npm run db:migrate -- --name descriptive_change`. To regenerate the local demo
from migrations, run `npm run db:reset -- --force`; this is destructive only to
the ignored local demo database, so do not use it against a database containing
non-demo records.

## MCP readiness

The functions in `src/data/queries.ts` can back NitroStack resources for
inventory availability, redistribution candidates, expiring stock, recall
exposure, quote comparison, purchase-order and receipt status, discrepancies,
asset availability, pending approvals, and audit trails.

Future tools can prepare transfers, RFQs and purchase orders; compare quotes;
quarantine recalled stock; allocate assets; request and record approval
decisions; execute approved actions; and prepare supplier notifications. Those
tools should call deterministic query/calculation services, record a prepared
action and evidence, enforce approval policy, execute separately, and append an
audit event. External email or supplier delivery is intentionally not part of
this database task.

## Intentional exclusions

The schema contains no forecasting, predictive demand, outbreak prediction,
diagnosis, treatment recommendation, or autonomous clinical decision model or
function. AI may later orchestrate workflows, but quantities, balances,
comparisons, eligibility, money, and validation remain deterministic code and
database operations.

## Workforce scheduling and notifications

Workforce job classification is deliberately separate from authorization.
`Role` and `UserAssignment` determine permissions and approval authority;
`StaffProfile.staffType` describes a nurse, pharmacist, technician, manager, or
other job classification. A clinical job title does not grant an approval role.

The workforce schema consists of:

- `StaffProfile` for employment state and integer-minute scheduling limits;
- `StaffSkill` for dated skill validity;
- `Shift` for location, local roster week, start/end time, required job type,
  required skill, headcount, and publication state;
- `ShiftAssignment` for draft, confirmed, absent, or cancelled allocation;
- `StaffUnavailability` for approved leave, sickness, training, and other
  availability restrictions; and
- `NotificationDelivery` for idempotent outbound-delivery state without storing
  the real recipient or provider credentials.

All hours are stored and calculated as integer minutes. Active profiles default
to 2,400 contracted minutes, 2,880 maximum minutes, 660 minutes minimum rest,
five consecutive shifts, and three consecutive night shifts.

### Deterministic ICU roster weeks

The published week runs from 6–12 July 2026 and contains 21 ICU shifts: day
07:00–15:00, evening 15:00–23:00, and night 23:00–07:00. It contains 44 seeded
assignment slots. The 9 July day shift requires four nurses and retains one
`ABSENT` assignment, leaving active coverage at 3/4.

The deterministic gap analysis recommends user 05. Their workload changes from
1,920 to 2,400 minutes. User 06 exceeds the weekly maximum, user 07 has approved
unavailability, user 08 lacks ICU critical-care skill, and user 09 violates
minimum rest. These are hard exclusion codes rather than opaque scores.

The planning week runs from 13–19 July 2026 and contains 21 open, unassigned ICU
shifts. `buildWeeklyRosterPlan` proposes all 42 slots without writing them. With
eight qualified nurses, two receive six shifts and six receive five.

### Hard scheduling rules and ranking

The application-neutral functions in `src/data/workforce.ts` enforce active
employment, matching staff type, valid skill through shift end, approved
unavailability, half-open interval overlap, 2,880 weekly minutes, 660 minutes
rest, five consecutive shifts, three consecutive nights, and no duplicate shift
assignment. `DRAFT` and `CONFIRMED` assignments count toward workload;
`ABSENT` and `CANCELLED` do not.

Every public workforce query requires an organization identifier and applies it
inside the Prisma query. Unknown and cross-organization identifiers therefore
share the same not-found behavior. Weekly workload includes active assignments
at every location in that organization. Rest checks use only the nearest
assignment on either side of a proposed shift, and consecutive limits apply to
the local Asia/Kolkata run containing the proposal rather than unrelated
historical runs.

Eligible candidates are ranked lexicographically by scheduled minutes, home
location match, recent shift-type continuity, consecutive-shift count, and
employee code. No random values, floating-point weights, forecasts, or LLM
scores participate in scheduling.

### Approval and delivery behavior

`WORKFORCE_ROSTER_PUBLISH` and `WORKFORCE_SHIFT_REASSIGN` each require one
`OPERATIONS_ADMIN` approval. A future Workforce Coordinator may prepare, but
must not autonomously execute, these actions:

- full-roster preparation creates a workflow, prepared action, and linked
  `DRAFT` assignments;
- approved roster execution changes drafts to `CONFIRMED` and shifts to
  `PUBLISHED`;
- gap replacement creates a `WORKFORCE_GAP` workflow and `REASSIGN_SHIFT`
  prepared action; and
- approved reassignment confirms one replacement while preserving the original
  `ABSENT` history.

The Workforce Coordinator MCP tools are not implemented yet. The database
foundation exposes these future resource boundaries:

- `getWeeklyRoster`
- `getUnfilledShifts`
- `getShiftCoverage`
- `getStaffWeeklyWorkload`
- `evaluateReplacementCandidates`
- `buildWeeklyRosterPlan`
- `getWorkforcePreparedAction`

Gmail delivery uses a unique idempotency key and a unique prepared-action/channel
pair. Only a masked address and a one-way recipient hash are stored. The runtime
tool must obtain the real recipient and Gmail credentials from environment
configuration, atomically advance `PENDING` → `SENDING` → `SENT` or `FAILED`,
increment attempts, and reuse the existing delivery row on retries.
