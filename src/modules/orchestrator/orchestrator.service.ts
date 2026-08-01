import { createHash } from 'node:crypto';
import { Injectable } from '@nitrostack/core';
import {
  buildCareFlowCatalog,
  getOperation,
  orchestrationPolicy,
  workflowRoutes,
} from './orchestrator.catalog.js';
import { OrchestratorRepository } from './orchestrator.repository.js';
import { RuntimeCareFlowToolRegistry, type CareFlowToolRegistry } from './orchestrator.registry.js';
import type {
  CareFlowHandoff,
  CareFlowHandoffInput,
  CareFlowSpecialist,
  HandoffIdentity,
  ListCareFlowHandoffsInput,
  ListCareFlowHandoffsResult,
  ResolvedEntities,
} from './orchestrator.types.js';
import { CareFlowOrchestratorError } from './orchestrator.types.js';

const MAX_CONTEXT_BYTES = 8_192;
const sensitiveKey = /(password|secret|token|apikey|authorization|cookie|credentials)/i;
const unsupportedRequest = /\b(diagnos(?:e|is|tic)|treatment advice|prescri(?:be|ption)|patient prognosis|forecast(?:ing)?|predict(?:ion|ive)?)\b/i;

function stableDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function findSensitivePath(value: unknown, path = 'context', depth = 0): string | null {
  if (depth > 8) return path;
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (sensitiveKey.test(key.replace(/[^A-Za-z]/g, ''))) return childPath;
    const nested = findSensitivePath(child, childPath, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function requiredInformation(workflow: string, operation: string, entities: ResolvedEntities): string[] {
  if (workflow === 'CONTROL_TOWER') return [];
  if (['analyze_inventory_shortage', 'prepare_internal_transfer', 'prepare_rfq'].includes(operation) && !entities.requirementId) {
    return ['Provide or resolve the stable requirementId for this inventory shortage.'];
  }
  if (operation === 'compare_supplier_quotes' && !entities.rfqId) {
    return ['Provide or resolve the stable rfqId whose supplier quotes should be compared.'];
  }
  if (operation === 'prepare_purchase_order' && !entities.rfqId && !entities.requirementId) {
    return ['Provide or resolve the stable rfqId or requirementId for the purchase-order preparation.'];
  }
  if (['analyze_staffing_gap', 'prepare_staff_reassignment'].includes(operation) && !entities.shiftId) {
    return ['Provide or resolve the stable shiftId for this workforce gap.'];
  }
  if (['build_weekly_roster_plan', 'prepare_weekly_roster'].includes(operation)) {
    const missing: string[] = [];
    if (!entities.locationId) missing.push('Provide or resolve the stable locationId for this workforce roster.');
    if (!entities.weekStart) missing.push('Provide or resolve the Monday weekStart in YYYY-MM-DD for this workforce roster.');
    return missing;
  }
  return [];
}

@Injectable({ deps: [OrchestratorRepository, RuntimeCareFlowToolRegistry] })
export class OrchestratorService {
  constructor(
    private readonly repository: OrchestratorRepository,
    private readonly toolRegistry: CareFlowToolRegistry,
  ) {}

  listCapabilities(): { specialists: CareFlowSpecialist[]; workflows: typeof workflowRoutes; policy: typeof orchestrationPolicy } {
    return { specialists: buildCareFlowCatalog(this.toolRegistry.registeredToolNames()), workflows: workflowRoutes, policy: orchestrationPolicy };
  }

  async createHandoff(input: CareFlowHandoffInput, identity: HandoffIdentity): Promise<CareFlowHandoff> {
    if (!identity.subject || !identity.organizationId) {
      throw new CareFlowOrchestratorError('AUTH_REQUIRED', 'An authenticated subject or explicitly configured demo actor is required.');
    }
    if (unsupportedRequest.test(`${input.userGoal} ${input.routingSummary}`)) {
      throw new CareFlowOrchestratorError('UNSUPPORTED_REQUEST', 'CareFlow routing does not provide forecasting, prediction, diagnosis, prescribing, or treatment advice.');
    }
    const sensitivePath = findSensitivePath(input.context);
    if (sensitivePath) {
      throw new CareFlowOrchestratorError('SENSITIVE_CONTEXT_REJECTED', `Remove sensitive context field ${sensitivePath} before creating the handoff.`);
    }
    const contextJson = JSON.stringify(input.context);
    if (Buffer.byteLength(contextJson, 'utf8') > MAX_CONTEXT_BYTES) {
      throw new CareFlowOrchestratorError('CONTEXT_TOO_LARGE', `Context must not exceed ${MAX_CONTEXT_BYTES} UTF-8 bytes.`);
    }

    const route = getOperation(input.workflow, input.targetAgentId, input.operation, this.toolRegistry.registeredToolNames());
    if (!route) {
      throw new CareFlowOrchestratorError('UNSUPPORTED_OPERATION', `${input.operation} is not registered for ${input.workflow} and ${input.targetAgentId}.`);
    }

    const stable = stableDigest(`${identity.organizationId}:${identity.subject}:${input.idempotencyKey}`);
    const now = new Date().toISOString();
    const missingInformation = requiredInformation(input.workflow, input.operation, input.resolvedEntities);
    if (!route.operation.available) {
      missingInformation.push(`Capability unavailable: ${route.operation.unavailableReason}`);
    }
    const status = missingInformation.length ? 'BLOCKED' : 'READY';
    const handoff: CareFlowHandoff = {
      requestId: `cfh_${stable.slice(0, 24)}`,
      idempotencyKey: input.idempotencyKey,
      workflow: input.workflow,
      userGoal: input.userGoal,
      targetAgentId: input.targetAgentId,
      operation: input.operation,
      resolvedEntities: input.resolvedEntities,
      constraints: input.constraints,
      successCriteria: input.successCriteria,
      routingSummary: input.routingSummary,
      context: input.context,
      allowedTools: [route.operation.toolName],
      risk: route.operation.risk,
      approvalBoundary: route.operation.approvalBoundary,
      missingInformation,
      nextTool: status === 'READY' ? route.operation.toolName : null,
      specialistPromptName: route.specialist.specialistPromptName,
      status,
      auditEventId: `audit_handoff_prepare_${stable.slice(0, 20)}`,
      createdAt: now,
      updatedAt: now,
    };
    return this.repository.create(handoff, identity);
  }

  async getHandoff(id: string, identity: HandoffIdentity): Promise<CareFlowHandoff> {
    if (!identity.subject || !identity.organizationId) {
      throw new CareFlowOrchestratorError('AUTH_REQUIRED', 'An authenticated subject or explicitly configured demo actor is required.');
    }
    const handoff = await this.repository.find(id, identity.organizationId);
    if (!handoff) throw new CareFlowOrchestratorError('HANDOFF_NOT_FOUND', `No CareFlow handoff was found for ${id}.`);
    return handoff;
  }

  listHandoffs(input: ListCareFlowHandoffsInput, identity: HandoffIdentity): Promise<ListCareFlowHandoffsResult> {
    if (!identity.subject || !identity.organizationId) {
      throw new CareFlowOrchestratorError('AUTH_REQUIRED', 'An authenticated subject or explicitly configured demo actor is required.');
    }
    return this.repository.list(input, identity.organizationId);
  }

  cancelHandoff(id: string, reason: string, identity: HandoffIdentity): Promise<CareFlowHandoff> {
    if (!identity.subject || !identity.organizationId) {
      throw new CareFlowOrchestratorError('AUTH_REQUIRED', 'An authenticated subject or explicitly configured demo actor is required.');
    }
    return this.repository.cancel(id, reason, identity);
  }
}
