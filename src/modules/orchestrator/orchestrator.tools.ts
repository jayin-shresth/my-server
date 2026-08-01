import { ExecutionContext, Injectable, ToolDecorator as Tool, Widget, z } from '@nitrostack/core';
import { OrchestratorService } from './orchestrator.service.js';
import {
  careFlowHandoffInputSchema,
  careFlowWorkflows,
  CareFlowOrchestratorError,
  handoffStates,
  type CareFlowHandoffInput,
  type HandoffIdentity,
} from './orchestrator.types.js';

function claimString(ctx: ExecutionContext, name: string): string | null {
  const value = ctx.auth?.claims?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function claimStrings(ctx: ExecutionContext, name: string): string[] {
  const value = ctx.auth?.claims?.[name];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim());
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function identityFromContext(ctx: ExecutionContext): HandoffIdentity {
  const authenticatedSubject = ctx.auth?.subject?.trim();
  const configuredOrganization = process.env.CAREFLOW_ORGANIZATION_ID?.trim();
  if (authenticatedSubject) {
    const organizationId = claimString(ctx, 'organization_id') ?? claimString(ctx, 'tenant_id') ?? configuredOrganization;
    if (!organizationId) {
      throw new CareFlowOrchestratorError('ORGANIZATION_REQUIRED', 'The authenticated request needs an organization_id claim or CAREFLOW_ORGANIZATION_ID configuration.');
    }
    return {
      subject: authenticatedSubject,
      organizationId,
      actorType: ctx.auth?.clientId ? 'SERVICE' : 'USER',
      executionRequestId: ctx.requestId,
      roles: [...new Set([...claimStrings(ctx, 'roles'), ...claimStrings(ctx, 'role_codes'), ...claimStrings(ctx, 'role')])],
      scopes: ctx.auth?.scopes?.filter(Boolean) ?? [],
    };
  }

  const demoActor = process.env.CAREFLOW_DEMO_ACTOR_ID?.trim();
  if (!demoActor) {
    throw new CareFlowOrchestratorError('AUTH_REQUIRED', 'An authenticated subject or CAREFLOW_DEMO_ACTOR_ID is required to persist or cancel a handoff.');
  }
  return {
    subject: demoActor,
    organizationId: process.env.CAREFLOW_DEMO_ORGANIZATION_ID?.trim() || configuredOrganization || 'org-careflow-001',
    actorType: 'DEMO',
    executionRequestId: ctx.requestId,
    roles: [],
    scopes: [],
  };
}

function toPublicError(error: unknown, ctx: ExecutionContext): never {
  if (error instanceof CareFlowOrchestratorError) {
    ctx.logger.warn('CareFlow orchestrator request rejected', { requestId: ctx.requestId, code: error.code });
    throw new Error(`${error.code}: ${error.message}`);
  }
  ctx.logger.error('Unexpected CareFlow orchestrator failure', { requestId: ctx.requestId });
  throw new Error('CAREFLOW_INTERNAL_ERROR: The CareFlow orchestrator could not complete the request safely.');
}

@Injectable({ deps: [OrchestratorService] })
export class OrchestratorTools {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Tool({
    name: 'open_agent_router',
    title: 'Open CareFlow Orchestrator',
    description: 'Open the CareFlow hospital operations routing widget. The host model remains the conversation and reasoning surface.',
    inputSchema: z.object({ workspace: z.string().trim().min(1).max(80).default('CareFlow admin') }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    invocation: { invoking: 'Opening CareFlow...', invoked: 'CareFlow ready' },
  })
  @Widget('agent-router')
  async openAgentRouter(input: { workspace: string }, ctx: ExecutionContext) {
    ctx.logger.info('Opening CareFlow orchestrator', { requestId: ctx.requestId, workspace: input.workspace });
    return { view: 'careflow_agent_router', workspace: input.workspace, ...this.orchestrator.listCapabilities() };
  }

  @Tool({
    name: 'list_careflow_capabilities',
    title: 'List CareFlow Capabilities',
    description: 'Read the five CareFlow workflow routes, two specialists, actual verified tool availability, risk, and approval boundaries before routing.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  })
  async listCapabilities(_input: Record<string, never>, ctx: ExecutionContext) {
    ctx.logger.info('Listing CareFlow capabilities', { requestId: ctx.requestId });
    return this.orchestrator.listCapabilities();
  }

  @Tool({
    name: 'create_careflow_handoff',
    title: 'Create CareFlow Handoff',
    description: 'Validate and persist one CareFlow routing decision. This does not execute domain work or prove that a specialist ran.',
    inputSchema: careFlowHandoffInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    invocation: { invoking: 'Validating CareFlow route...', invoked: 'CareFlow route persisted' },
  })
  async createHandoff(input: CareFlowHandoffInput, ctx: ExecutionContext) {
    try {
      const handoff = await this.orchestrator.createHandoff(input, identityFromContext(ctx));
      ctx.logger.info('Persisted CareFlow handoff', {
        requestId: ctx.requestId,
        handoffId: handoff.requestId,
        workflow: handoff.workflow,
        status: handoff.status,
        nextTool: handoff.nextTool,
      });
      return {
        handoff,
        instruction: handoff.status === 'READY'
          ? `Call only ${handoff.nextTool}. Treat its deterministic result as authoritative.`
          : `Do not call a domain tool. Resolve: ${handoff.missingInformation.join(' ')}`,
      };
    } catch (error) {
      return toPublicError(error, ctx);
    }
  }

  @Tool({
    name: 'get_careflow_handoff',
    title: 'Get CareFlow Handoff',
    description: 'Read a persisted CareFlow handoff by its handoff ID or workflow-run ID.',
    inputSchema: z.object({ id: z.string().trim().min(4).max(160) }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  })
  async getHandoff(input: { id: string }, ctx: ExecutionContext) {
    try {
      ctx.logger.info('Reading CareFlow handoff', { requestId: ctx.requestId, handoffId: input.id });
      return { handoff: await this.orchestrator.getHandoff(input.id, identityFromContext(ctx)) };
    } catch (error) {
      return toPublicError(error, ctx);
    }
  }

  @Tool({
    name: 'list_careflow_handoffs',
    title: 'List CareFlow Handoffs',
    description: 'List persisted CareFlow handoffs in the authenticated organization with optional workflow and status filters.',
    inputSchema: z.object({
      workflow: z.enum(careFlowWorkflows).optional(),
      status: z.enum(handoffStates).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.string().trim().min(4).max(160).optional(),
    }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  })
  async listHandoffs(
    input: { workflow?: (typeof careFlowWorkflows)[number]; status?: (typeof handoffStates)[number]; limit: number; cursor?: string },
    ctx: ExecutionContext,
  ) {
    try {
      ctx.logger.info('Listing CareFlow handoffs', { requestId: ctx.requestId, workflow: input.workflow, status: input.status });
      return await this.orchestrator.listHandoffs(input, identityFromContext(ctx));
    } catch (error) {
      return toPublicError(error, ctx);
    }
  }

  @Tool({
    name: 'cancel_careflow_handoff',
    title: 'Cancel CareFlow Handoff',
    description: 'Cancel a non-terminal persisted handoff and record the cancellation in the CareFlow audit log.',
    inputSchema: z.object({ id: z.string().trim().min(4).max(160), reason: z.string().trim().min(5).max(300) }).strict(),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  })
  async cancelHandoff(input: { id: string; reason: string }, ctx: ExecutionContext) {
    try {
      const handoff = await this.orchestrator.cancelHandoff(input.id, input.reason, identityFromContext(ctx));
      ctx.logger.info('Cancelled CareFlow handoff', { requestId: ctx.requestId, handoffId: handoff.requestId, auditEventId: handoff.auditEventId });
      return { handoff, auditReference: handoff.auditEventId };
    } catch (error) {
      return toPublicError(error, ctx);
    }
  }
}
