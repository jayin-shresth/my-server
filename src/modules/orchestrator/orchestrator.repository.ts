import { createHash } from 'node:crypto';
import { Injectable } from '@nitrostack/core';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type {
  CareFlowHandoff,
  HandoffIdentity,
  ListCareFlowHandoffsInput,
  ListCareFlowHandoffsResult,
} from './orchestrator.types.js';
import { CareFlowOrchestratorError } from './orchestrator.types.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function requestFingerprint(handoff: CareFlowHandoff): string {
  return digest(JSON.stringify(canonicalize({
    idempotencyKey: handoff.idempotencyKey,
    workflow: handoff.workflow,
    userGoal: handoff.userGoal,
    targetAgentId: handoff.targetAgentId,
    operation: handoff.operation,
    resolvedEntities: handoff.resolvedEntities,
    constraints: handoff.constraints,
    successCriteria: handoff.successCriteria,
    routingSummary: handoff.routingSummary,
    context: handoff.context,
  })));
}

function assertSameIdempotentRequest(existing: CareFlowHandoff, candidate: CareFlowHandoff): void {
  if (requestFingerprint(existing) !== requestFingerprint(candidate)) {
    throw new CareFlowOrchestratorError(
      'IDEMPOTENCY_CONFLICT',
      `Idempotency key ${candidate.idempotencyKey} is already associated with a different CareFlow handoff request.`,
    );
  }
}

export const ORCHESTRATOR_PRISMA = Symbol('CAREFLOW_ORCHESTRATOR_PRISMA');

function parseHandoff(payloadJson: string): CareFlowHandoff {
  try {
    return JSON.parse(payloadJson) as CareFlowHandoff;
  } catch {
    throw new CareFlowOrchestratorError('HANDOFF_DATA_INVALID', 'The persisted handoff payload could not be read safely.');
  }
}

@Injectable({ deps: [ORCHESTRATOR_PRISMA] })
export class OrchestratorRepository {
  constructor(private readonly client: PrismaClient) {}

  async find(id: string, organizationId: string): Promise<CareFlowHandoff | null> {
    const direct = await this.client.preparedAction.findFirst({
      where: { id, actionType: 'AGENT_HANDOFF', workflowRun: { is: { organizationId } } },
    });
    if (direct) return parseHandoff(direct.payloadJson);

    const workflow = await this.client.workflowRun.findFirst({
      where: { organizationId, OR: [{ id }, { code: id }, { correlationId: id }] },
      include: { preparedActions: { where: { actionType: 'AGENT_HANDOFF' }, take: 1 } },
    });
    const action = workflow?.preparedActions[0];
    return action ? parseHandoff(action.payloadJson) : null;
  }

  async list(input: ListCareFlowHandoffsInput, organizationId: string): Promise<ListCareFlowHandoffsResult> {
    let cursorAction: { id: string; preparedAt: Date } | null = null;
    if (input.cursor) {
      cursorAction = await this.client.preparedAction.findFirst({
        where: {
          id: input.cursor,
          actionType: 'AGENT_HANDOFF',
          workflowRun: { is: { organizationId } },
        },
        select: { id: true, preparedAt: true },
      });
      if (!cursorAction) {
        throw new CareFlowOrchestratorError('HANDOFF_CURSOR_INVALID', 'The handoff list cursor is invalid or outside this organization.');
      }
    }

    const where: Prisma.PreparedActionWhereInput = {
      actionType: 'AGENT_HANDOFF',
      ...(input.status ? { status: input.status } : {}),
      workflowRun: {
        is: {
          organizationId,
          ...(input.workflow ? { workflowType: input.workflow } : {}),
        },
      },
      ...(cursorAction ? {
        OR: [
          { preparedAt: { lt: cursorAction.preparedAt } },
          { preparedAt: cursorAction.preparedAt, id: { lt: cursorAction.id } },
        ],
      } : {}),
    };
    const actions = await this.client.preparedAction.findMany({
      where,
      orderBy: [{ preparedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const hasMore = actions.length > input.limit;
    const page = hasMore ? actions.slice(0, input.limit) : actions;
    return {
      handoffs: page.map((action) => parseHandoff(action.payloadJson)),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  }

  async create(handoff: CareFlowHandoff, identity: HandoffIdentity): Promise<CareFlowHandoff> {
    const existing = await this.find(handoff.requestId, identity.organizationId);
    if (existing) {
      assertSameIdempotentRequest(existing, handoff);
      return existing;
    }

    const stable = digest(`${identity.organizationId}:${identity.subject}:${handoff.idempotencyKey}`);
    const workflowRunId = `cwf_${stable.slice(0, 24)}`;
    const workflowCode = `CF-HANDOFF-${stable.slice(0, 16).toUpperCase()}`;
    const correlationId = `careflow-handoff:${stable}`;
    const actionCode = `CF-ACTION-${stable.slice(0, 16).toUpperCase()}`;
    const firstEntityId = Object.values(handoff.resolvedEntities).find(Boolean) ?? handoff.requestId;

    try {
      await this.client.$transaction(async (transaction) => {
        const maxSequence = await transaction.auditEvent.aggregate({ _max: { sequence: true } });
        await transaction.workflowRun.create({
          data: {
            id: workflowRunId,
            organizationId: identity.organizationId,
            code: workflowCode,
            workflowType: handoff.workflow,
            status: handoff.status,
            startedAt: new Date(handoff.createdAt),
            completedAt: null,
            correlationId,
          },
        });
        await transaction.preparedAction.create({
          data: {
            id: handoff.requestId,
            code: actionCode,
            workflowRunId,
            actionType: 'AGENT_HANDOFF',
            requesterType: identity.actorType,
            requesterId: identity.subject,
            status: handoff.status,
            amountPaise: null,
            targetType: 'CAREFLOW_WORKFLOW',
            targetId: firstEntityId,
            payloadJson: JSON.stringify(handoff),
            evidenceJson: JSON.stringify({ catalogVersion: '2.0.0', allowedTools: handoff.allowedTools }),
            reasoningSummary: handoff.routingSummary,
            preparedAt: new Date(handoff.createdAt),
          },
        });
        await transaction.auditEvent.create({
          data: {
            id: handoff.auditEventId,
            organizationId: identity.organizationId,
            sequence: (maxSequence._max.sequence ?? 0) + 1,
            eventType: 'CAREFLOW_HANDOFF_PREPARED',
            actorType: identity.actorType,
            actorId: identity.subject,
            subjectType: 'PREPARED_ACTION',
            subjectId: handoff.requestId,
            occurredAt: new Date(handoff.createdAt),
            detailsJson: JSON.stringify({
              requestId: handoff.requestId,
              executionRequestId: identity.executionRequestId,
              workflow: handoff.workflow,
              status: handoff.status,
            }),
          },
        });
      });
      return handoff;
    } catch {
      const concurrent = await this.find(handoff.requestId, identity.organizationId);
      if (concurrent) {
        assertSameIdempotentRequest(concurrent, handoff);
        return concurrent;
      }
      throw new CareFlowOrchestratorError('HANDOFF_PERSISTENCE_FAILED', 'The handoff could not be persisted. Verify the CareFlow organization configuration.');
    }
  }

  async cancel(id: string, reason: string, identity: HandoffIdentity): Promise<CareFlowHandoff> {
    const existing = await this.find(id, identity.organizationId);
    if (!existing) throw new CareFlowOrchestratorError('HANDOFF_NOT_FOUND', `No CareFlow handoff was found for ${id}.`);
    if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(existing.status)) {
      throw new CareFlowOrchestratorError('HANDOFF_TERMINAL', `Handoff ${existing.requestId} is already ${existing.status}.`);
    }

    const updated: CareFlowHandoff = {
      ...existing,
      status: 'CANCELLED',
      nextTool: null,
      auditEventId: `audit_handoff_cancel_${digest(existing.requestId).slice(0, 20)}`,
      updatedAt: new Date().toISOString(),
    };

    await this.client.$transaction(async (transaction) => {
      const action = await transaction.preparedAction.findUnique({ where: { id: existing.requestId }, include: { workflowRun: true } });
      if (!action) throw new CareFlowOrchestratorError('HANDOFF_NOT_FOUND', `No CareFlow handoff was found for ${id}.`);
      if (action.workflowRun.organizationId !== identity.organizationId) {
        throw new CareFlowOrchestratorError('HANDOFF_NOT_FOUND', `No CareFlow handoff was found for ${id}.`);
      }
      const trustedRoles = new Set(identity.roles.map((role) => role.trim().toUpperCase()));
      const trustedScopes = new Set(identity.scopes.map((scope) => scope.trim().toLowerCase()));
      let mayCancelAny = trustedRoles.has('OPERATIONS_ADMIN')
        || trustedRoles.has('ADMIN')
        || trustedScopes.has('careflow:handoffs:cancel:any');
      if (action.requesterId !== identity.subject && !mayCancelAny) {
        const databaseRole = await transaction.userAssignment.findFirst({
          where: {
            userId: identity.subject,
            user: { is: { organizationId: identity.organizationId, active: true } },
            role: { is: { code: { in: ['OPERATIONS_ADMIN', 'ADMIN'] } } },
          },
          select: { id: true },
        });
        mayCancelAny = Boolean(databaseRole);
      }
      if (action.requesterId !== identity.subject && !mayCancelAny) {
        throw new CareFlowOrchestratorError(
          'HANDOFF_CANCEL_FORBIDDEN',
          'Only the handoff requester or an authorized operations administrator may cancel this handoff.',
        );
      }
      const maxSequence = await transaction.auditEvent.aggregate({ _max: { sequence: true } });
      await transaction.preparedAction.update({
        where: { id: existing.requestId },
        data: { status: 'CANCELLED', payloadJson: JSON.stringify(updated) },
      });
      await transaction.workflowRun.update({
        where: { id: action.workflowRunId },
        data: { status: 'CANCELLED', completedAt: new Date(updated.updatedAt) },
      });
      await transaction.auditEvent.create({
        data: {
          id: updated.auditEventId,
          organizationId: identity.organizationId,
          sequence: (maxSequence._max.sequence ?? 0) + 1,
          eventType: 'CAREFLOW_HANDOFF_CANCELLED',
          actorType: identity.actorType,
          actorId: identity.subject,
          subjectType: 'PREPARED_ACTION',
          subjectId: existing.requestId,
          occurredAt: new Date(updated.updatedAt),
          detailsJson: JSON.stringify({ requestId: existing.requestId, executionRequestId: identity.executionRequestId, reason }),
        },
      });
    });
    return updated;
  }

  async countAuditEvents(subjectId: string, eventType: string): Promise<number> {
    return this.client.auditEvent.count({ where: { subjectId, eventType } });
  }
}
