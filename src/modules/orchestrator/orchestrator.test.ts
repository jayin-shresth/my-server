import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { extractTools } from '@nitrostack/core';
import { PrismaClient } from '../../generated/prisma/client.js';
import { WorkforceTools } from '../workforce/workforce.tools.js';
import { buildCareFlowCatalog, workflowRoutes } from './orchestrator.catalog.js';
import { OrchestratorRepository } from './orchestrator.repository.js';
import { RuntimeCareFlowToolRegistry } from './orchestrator.registry.js';
import { OrchestratorService } from './orchestrator.service.js';
import { OrchestratorTools } from './orchestrator.tools.js';
import { careFlowHandoffInputSchema, careFlowWorkflows, CareFlowOrchestratorError, type HandoffIdentity } from './orchestrator.types.js';

const allIntegratedTools = new Set(buildCareFlowCatalog(new Set([
  'get_control_tower_summary',
  'analyze_inventory_shortage',
  'prepare_internal_transfer',
  'prepare_rfq',
  'compare_supplier_quotes',
  'prepare_purchase_order',
  'analyze_staffing_gap',
  'prepare_staff_reassignment',
  'build_weekly_roster_plan',
  'prepare_weekly_roster',
])).flatMap((specialist) => specialist.operations.map((operation) => operation.toolName)));
const registry = (names: ReadonlySet<string>) => ({ registeredToolNames: () => names });

const identity: HandoffIdentity = {
  subject: 'careflow-orchestrator-test',
  organizationId: 'org-careflow-001',
  actorType: 'DEMO',
  executionRequestId: 'test-execution-request',
  roles: [],
  scopes: [],
};

let temporaryDirectory: string;
let client: PrismaClient;
let repository: OrchestratorRepository;
let service: OrchestratorService;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'careflow-orchestrator-'));
  const databasePath = join(temporaryDirectory, 'careflow-test.db');
  await copyFile(resolve('database/careflow.db'), databasePath);
  const adapter = new PrismaBetterSqlite3({ url: `file:${databasePath.replace(/\\/g, '/')}` });
  client = new PrismaClient({ adapter });
  assert.ok(await client.organization.findUnique({ where: { id: identity.organizationId } }), 'seed organization must exist');
  repository = new OrchestratorRepository(client);
  service = new OrchestratorService(repository, registry(allIntegratedTools));
});

after(async () => {
  await client?.$disconnect();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

function inventoryInput(idempotencyKey: string, requirementId = 'requirement-icu-001') {
  return careFlowHandoffInputSchema.parse({
    idempotencyKey,
    workflow: 'INVENTORY_SHORTAGE',
    userGoal: 'Resolve the known ICU inventory shortage safely.',
    targetAgentId: 'inventory-procurement-agent',
    operation: 'analyze_inventory_shortage',
    resolvedEntities: requirementId ? { requirementId } : {},
    constraints: ['Use authoritative CareFlow records only.'],
    successCriteria: ['Return deterministic shortage evidence.'],
    routingSummary: 'Route the known ICU requirement for read-only shortage analysis.',
    context: { source: 'orchestrator-test' },
  });
}

function controlTowerInput(idempotencyKey: string) {
  return careFlowHandoffInputSchema.parse({
    idempotencyKey,
    workflow: 'CONTROL_TOWER',
    userGoal: 'Open today\'s CareFlow control tower.',
    targetAgentId: 'inventory-procurement-agent',
    operation: 'get_control_tower_summary',
    resolvedEntities: {},
    constraints: ['Use current authoritative operational records.'],
    successCriteria: ['Return the deterministic control-tower summary.'],
    routingSummary: 'Route the read-only CareFlow control-tower summary request.',
    context: {},
  });
}

function workforceGapInput(idempotencyKey: string, shiftId = 'shift-icu-20260709-day') {
  return careFlowHandoffInputSchema.parse({
    idempotencyKey,
    workflow: 'WORKFORCE_GAP',
    userGoal: 'Resolve the known ICU staffing gap safely.',
    targetAgentId: 'workforce-coordinator',
    operation: 'analyze_staffing_gap',
    resolvedEntities: shiftId ? { shiftId } : {},
    constraints: ['Use authoritative workforce records only.'],
    successCriteria: ['Return deterministic staffing-gap evidence.'],
    routingSummary: 'Route the known shift for read-only staffing-gap analysis.',
    context: {},
  });
}

function workforceRosterInput(idempotencyKey: string, resolvedEntities: { locationId?: string; weekStart?: string } = {
  locationId: 'loc-04', weekStart: '2026-07-13',
}) {
  return careFlowHandoffInputSchema.parse({
    idempotencyKey,
    workflow: 'WORKFORCE_ROSTER',
    userGoal: 'Build the known ICU weekly roster safely.',
    targetAgentId: 'workforce-coordinator',
    operation: 'build_weekly_roster_plan',
    resolvedEntities,
    constraints: ['Use authoritative workforce records only.'],
    successCriteria: ['Return a deterministic constraint-checked roster plan.'],
    routingSummary: 'Route the ICU location and Monday week start for roster planning.',
    context: {},
  });
}

test('every CareFlow workflow maps to exactly one valid specialist', () => {
  const catalog = buildCareFlowCatalog(allIntegratedTools);
  assert.equal(Object.keys(workflowRoutes).length, careFlowWorkflows.length);
  for (const workflow of careFlowWorkflows) {
    const route = workflowRoutes[workflow];
    const specialist = catalog.find((candidate) => candidate.id === route.specialistId);
    assert.ok(specialist, `${workflow} specialist must exist`);
    assert.ok(route.operations.length > 0);
    assert.ok(route.operations.every((name) => specialist.operations.some((operation) => operation.name === name)));
  }
});

test('availability comes only from NitroStack runtime registrations', () => {
  const previous = process.env.CAREFLOW_INTEGRATED_TOOLS;
  process.env.CAREFLOW_INTEGRATED_TOOLS = 'nonexistent_configured_tool';
  try {
    const runtimeRegistry = new RuntimeCareFlowToolRegistry({ tools: new Map([['get_control_tower_summary', {}]]) } as never);
    assert.deepEqual([...runtimeRegistry.registeredToolNames()], ['get_control_tower_summary']);
    const catalog = buildCareFlowCatalog(runtimeRegistry.registeredToolNames());
    assert.equal(catalog.flatMap((specialist) => specialist.operations).find((operation) => operation.name === 'get_control_tower_summary')?.available, true);
    assert.equal(catalog.flatMap((specialist) => specialist.operations).find((operation) => operation.name === 'analyze_inventory_shortage')?.available, false);
  } finally {
    if (previous === undefined) delete process.env.CAREFLOW_INTEGRATED_TOOLS;
    else process.env.CAREFLOW_INTEGRATED_TOOLS = previous;
  }
});

test('the actual WorkforceTools surface registers every workforce routing operation', () => {
  const workforceNames = new Set(extractTools(WorkforceTools).map((entry) => entry.options.name));
  for (const name of ['analyze_staffing_gap', 'prepare_staff_reassignment', 'build_weekly_roster_plan', 'prepare_weekly_roster']) {
    assert.ok(workforceNames.has(name), `${name} must be registered by WorkforceTools`);
  }
  const workforce = buildCareFlowCatalog(workforceNames).find((specialist) => specialist.id === 'workforce-coordinator');
  assert.ok(workforce);
  assert.ok(workforce.operations.every((operation) => operation.available));
});

test('the MCP surface includes tenant-scoped handoff listing', () => {
  const names = extractTools(OrchestratorTools).map((entry) => entry.options.name);
  assert.ok(names.includes('list_careflow_handoffs'));
});

test('the discriminated schema accepts only workflow-registered operations and server-owned fields', () => {
  assert.equal(careFlowHandoffInputSchema.safeParse(inventoryInput('schema-valid-001')).success, true);
  const invalid = { ...inventoryInput('schema-invalid-001'), operation: 'unregistered_operation' };
  assert.equal(careFlowHandoffInputSchema.safeParse(invalid).success, false);
  assert.equal(careFlowHandoffInputSchema.safeParse({ ...inventoryInput('schema-invalid-002'), allowedTools: ['anything'] }).success, false);
});

test('the server derives allowed tools, risk, and next tool', async () => {
  const handoff = await service.createHandoff(inventoryInput('derive-policy-001'), identity);
  assert.deepEqual(handoff.allowedTools, ['analyze_inventory_shortage']);
  assert.equal(handoff.risk, 'READ_ONLY');
  assert.equal(handoff.nextTool, 'analyze_inventory_shortage');
  assert.equal(handoff.status, 'READY');
});

test('CONTROL_TOWER uses its dedicated summary operation without a requirement ID', async () => {
  const handoff = await service.createHandoff(controlTowerInput('control-tower-001'), identity);
  assert.equal(handoff.operation, 'get_control_tower_summary');
  assert.equal(handoff.nextTool, 'get_control_tower_summary');
  assert.equal(handoff.status, 'READY');
  assert.deepEqual(handoff.resolvedEntities, {});
});

test('a missing required stable ID persists a precise BLOCKED handoff', async () => {
  const handoff = await service.createHandoff(inventoryInput('missing-id-001', ''), identity);
  assert.equal(handoff.status, 'BLOCKED');
  assert.equal(handoff.nextTool, null);
  assert.deepEqual(handoff.missingInformation, ['Provide or resolve the stable requirementId for this inventory shortage.']);
});

test('workforce gap and roster workflows enforce their distinct required routing facts', async () => {
  const gap = await service.createHandoff(workforceGapInput('missing-shift-001', ''), identity);
  assert.equal(gap.status, 'BLOCKED');
  assert.deepEqual(gap.missingInformation, ['Provide or resolve the stable shiftId for this workforce gap.']);

  const roster = await service.createHandoff(workforceRosterInput('missing-roster-001', {}), identity);
  assert.equal(roster.status, 'BLOCKED');
  assert.equal(roster.nextTool, null);
  assert.deepEqual(roster.missingInformation, [
    'Provide or resolve the stable locationId for this workforce roster.',
    'Provide or resolve the Monday weekStart in YYYY-MM-DD for this workforce roster.',
  ]);
});

test('workforce gap and roster handoffs become READY only for their registered live tools', async () => {
  const gap = await service.createHandoff(workforceGapInput('ready-gap-001'), identity);
  assert.equal(gap.status, 'READY');
  assert.equal(gap.nextTool, 'analyze_staffing_gap');

  const roster = await service.createHandoff(workforceRosterInput('ready-roster-001'), identity);
  assert.equal(roster.status, 'READY');
  assert.equal(roster.nextTool, 'build_weekly_roster_plan');

  const unavailableRosterService = new OrchestratorService(repository, registry(new Set(['analyze_staffing_gap'])));
  const unavailable = await unavailableRosterService.createHandoff(workforceRosterInput('unavailable-roster-001'), identity);
  assert.equal(unavailable.status, 'BLOCKED');
  assert.equal(unavailable.nextTool, null);
});

test('an unavailable capability is BLOCKED and never reported as dispatched', async () => {
  const unavailableService = new OrchestratorService(repository, registry(new Set()));
  const handoff = await unavailableService.createHandoff(inventoryInput('unavailable-tool-001'), identity);
  assert.equal(handoff.status, 'BLOCKED');
  assert.equal(handoff.nextTool, null);
  assert.match(handoff.missingInformation.join(' '), /no verified registered provider/i);
  assert.doesNotMatch(JSON.stringify(handoff), /dispatched/i);
});

test('an idempotency key returns one durable handoff across service instances', async () => {
  const input = inventoryInput('persistent-idempotency-001');
  const first = await service.createHandoff(input, identity);
  const second = await service.createHandoff(input, identity);
  const freshService = new OrchestratorService(new OrchestratorRepository(client), registry(allIntegratedTools));
  const persisted = await freshService.getHandoff(first.requestId, identity);
  assert.equal(second.requestId, first.requestId);
  assert.equal(second.createdAt, first.createdAt);
  assert.deepEqual(persisted, first);
});

test('reusing an idempotency key with different request content is rejected', async () => {
  const original = inventoryInput('idempotency-conflict-001');
  await service.createHandoff(original, identity);
  await assert.rejects(
    service.createHandoff({ ...original, userGoal: 'Resolve a different inventory shortage request.' }, identity),
    (error: unknown) => error instanceof CareFlowOrchestratorError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('handoffs can be listed with tenant-scoped filters and stable pagination', async () => {
  await service.createHandoff(inventoryInput('list-ready-001'), identity);
  await service.createHandoff(inventoryInput('list-ready-002'), identity);
  await service.createHandoff(inventoryInput('list-ready-003'), identity);
  const firstPage = await service.listHandoffs({ workflow: 'INVENTORY_SHORTAGE', status: 'READY', limit: 2 }, identity);
  assert.equal(firstPage.handoffs.length, 2);
  assert.ok(firstPage.nextCursor);
  const secondPage = await service.listHandoffs({ workflow: 'INVENTORY_SHORTAGE', status: 'READY', limit: 2, cursor: firstPage.nextCursor! }, identity);
  assert.ok(secondPage.handoffs.length >= 1);
  assert.equal(new Set([...firstPage.handoffs, ...secondPage.handoffs].map((handoff) => handoff.requestId)).size, firstPage.handoffs.length + secondPage.handoffs.length);
});

test('cancelling a non-terminal handoff creates one cancellation audit event', async () => {
  const prepared = await service.createHandoff(inventoryInput('cancel-audit-001'), identity);
  const beforeCount = await repository.countAuditEvents(prepared.requestId, 'CAREFLOW_HANDOFF_CANCELLED');
  const cancelled = await service.cancelHandoff(prepared.requestId, 'The operator withdrew the routing request.', identity);
  const afterCount = await repository.countAuditEvents(prepared.requestId, 'CAREFLOW_HANDOFF_CANCELLED');
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.nextTool, null);
  assert.equal(afterCount, beforeCount + 1);
});

test('only the requester or an operations administrator may cancel a handoff', async () => {
  const prepared = await service.createHandoff(inventoryInput('cancel-authorization-001'), identity);
  const unauthorized: HandoffIdentity = { ...identity, subject: 'user-01', actorType: 'USER' };
  await assert.rejects(
    service.cancelHandoff(prepared.requestId, 'Attempted cancellation by another user.', unauthorized),
    (error: unknown) => error instanceof CareFlowOrchestratorError && error.code === 'HANDOFF_CANCEL_FORBIDDEN',
  );
  const operationsAdmin: HandoffIdentity = { ...identity, subject: 'user-12', actorType: 'USER' };
  const cancelled = await service.cancelHandoff(prepared.requestId, 'Operations administrator cancelled the request.', operationsAdmin);
  assert.equal(cancelled.status, 'CANCELLED');
});

test('sensitive context keys are rejected at any nesting depth', async () => {
  const input = { ...inventoryInput('sensitive-context-001'), context: { vendor: { api_key: 'do-not-store' } } };
  await assert.rejects(service.createHandoff(input, identity), (error: unknown) => (
    error instanceof CareFlowOrchestratorError && error.code === 'SENSITIVE_CONTEXT_REJECTED'
  ));
});

test('clinical and predictive requests are refused', async () => {
  const input = { ...inventoryInput('unsupported-request-001'), userGoal: 'Predict the patient prognosis and prescribe treatment advice.' };
  await assert.rejects(service.createHandoff(input, identity), (error: unknown) => (
    error instanceof CareFlowOrchestratorError && error.code === 'UNSUPPORTED_REQUEST'
  ));
});

test('no fake approval ID or anonymous persisted operation is accepted', async () => {
  const handoff = await service.createHandoff(inventoryInput('no-fake-approval-001'), identity);
  assert.equal('approvalId' in handoff, false);
  await assert.rejects(
    service.createHandoff(inventoryInput('anonymous-denied-001'), { ...identity, subject: '' }),
    (error: unknown) => error instanceof CareFlowOrchestratorError && error.code === 'AUTH_REQUIRED',
  );
});

test('the widget manifest has exactly one router and workforce preview with two specialists', async () => {
  const manifest = JSON.parse(await readFile(resolve('src/widgets/widget-manifest.json'), 'utf8')) as {
    widgets: Array<{ uri: string; name: string; examples?: Array<{ data?: { specialists?: Array<{ id: string }> } }> }>;
  };
  const router = manifest.widgets.find((widget) => widget.uri === '/agent-router');
  assert.equal(manifest.widgets.filter((widget) => widget.uri === '/agent-router').length, 1);
  assert.equal(manifest.widgets.filter((widget) => widget.uri === '/workforce-coordinator').length, 1);
  assert.equal(manifest.widgets.some((widget) => widget.uri === '/calculator-result'), false);
  assert.equal(router?.name, 'CareFlow Orchestrator');
  assert.equal(router?.examples?.length, 1);
  assert.deepEqual(router?.examples?.[0].data?.specialists?.map((specialist) => specialist.id), [
    'inventory-procurement-agent', 'workforce-coordinator',
  ]);
});

test('the final catalog contains only the two active product specialists', () => {
  const catalog = buildCareFlowCatalog(allIntegratedTools);
  assert.deepEqual(catalog.map((specialist) => specialist.id), [
    'inventory-procurement-agent', 'workforce-coordinator',
  ]);
  assert.equal(catalog.length, 2);
});

test('the orchestrator prompt forbids exposing chain-of-thought', async () => {
  const promptSource = await readFile(resolve('src/modules/orchestrator/orchestrator.prompts.ts'), 'utf8');
  assert.match(promptSource, /Never expose or request private chain-of-thought/);
  assert.doesNotMatch(promptSource, /reveal (?:your |private )?chain-of-thought/i);
});
