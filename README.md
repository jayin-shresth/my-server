# CareFlow Logistics

CareFlow hospital operations MCP server with a governed orchestration front door.

The CareFlow Logistics database foundation is documented in
[`DATABASE.md`](./DATABASE.md), including setup, deterministic scenarios,
validation, and MCP-ready access boundaries.

## CareFlow orchestrator

Call `open_agent_router` or start the `careflow_orchestrator_session` prompt in
NitroStudio. NitroChat remains the reasoning and conversation surface: it
classifies a request, resolves stable CareFlow IDs, and submits a strict routing
decision to `create_careflow_handoff`. The router validates that decision against
the server-owned catalog and persists an idempotent `AGENT_HANDOFF` using
`WorkflowRun`, `PreparedAction`, and `AuditEvent`.

A `READY` handoff names the one verified next MCP tool NitroChat may call. A
`BLOCKED` handoff identifies a missing record ID or a capability whose provider
has not been integrated; persistence never means that a specialist executed.
The catalog models inventory/procurement and workforce specialists,
but runtime availability is always derived from tools that are actually
registered. This release integrates the Workforce Coordinator end to end for
staffing gaps and weekly rosters. Inventory/procurement routes remain visibly
unavailable until their provider is installed; the
orchestrator never fabricates a successful delegation. Widgets display routing
and status while full reasoning and results remain in the host conversation.

For local unauthenticated demos, copy `.env.example` to `.env`; it provides the
seeded `CAREFLOW_DEMO_ACTOR_ID=user-01` and
`CAREFLOW_DEMO_ORGANIZATION_ID=org-careflow-001`. In authenticated deployments,
remove the demo identity and provide an
`organization_id`/`tenant_id` claim or `CAREFLOW_ORGANIZATION_ID`. Tool
availability is read from NitroStack's live runtime registry, so unregistered
domain tools remain unavailable automatically.

## What This Template Includes

- CareFlow orchestration tools, resource, prompt, and responsive widget
- TypeScript + Zod validation setup
- Widget-ready project structure
- Production-friendly npm scripts

## Quick Start

```bash
npm install
npm run db:generate
npm run db:check
npm run dev
```

## Common Commands

```bash
npm run dev
npm run build
npm start
```

## NitroStudio

NitroStudio is the recommended way to test and debug this template during
development.

- Download: <https://nitrostack.ai/studio>
- Studio: <https://nitrostack.ai/studio>

Select this project folder and click **Connect**. For the complete agentic flow,
start the `careflow_orchestrator_session` prompt or ask NitroChat to route the
request through CareFlow. Direct tool execution is intended for isolated MCP
testing and does not replace the orchestrator handoff.

Known deterministic demo inputs:

- Staffing gap: `shift-icu-20260709-day`
- Weekly roster: `locationId=loc-04`, `weekStart=2026-07-13`

## Links

- Docs: <https://docs.nitrostack.ai>
- Templates docs: <https://docs.nitrostack.ai/templates/01-starter-template>
- Main repository: <https://github.com/nitrocloudofficial/nitrostack>

## Community

- Discord: <https://discord.gg/uVWey6UhuD>
- X: <https://x.com/nitrostackai>
- YouTube: <https://www.youtube.com/@nitrostackai>
- LinkedIn: <https://linkedin.com/company/nitrostack-ai/>
- GitHub: <https://github.com/nitrostackai>
