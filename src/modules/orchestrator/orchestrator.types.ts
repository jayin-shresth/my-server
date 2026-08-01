import { z } from '@nitrostack/core';
import { weekStartSchema } from '../workforce/workforce.types.js';

export const careFlowWorkflows = [
  'CONTROL_TOWER',
  'INVENTORY_SHORTAGE',
  'PROCUREMENT',
  'WORKFORCE_GAP',
  'WORKFORCE_ROSTER',
] as const;

export const handoffStates = ['PREPARED', 'READY', 'BLOCKED', 'CANCELLED', 'COMPLETED', 'FAILED'] as const;
export const handoffRisks = ['READ_ONLY', 'DRAFT', 'GOVERNED_WRITE', 'EXTERNAL_ACTION'] as const;

const idempotencyKeySchema = z.string()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Use a stable opaque key containing letters, numbers, dots, colons, underscores, or hyphens.');
const boundedText = z.string().trim().min(1).max(300);
const commonHandoffInput = {
  idempotencyKey: idempotencyKeySchema,
  userGoal: z.string().trim().min(8).max(1200),
  constraints: z.array(boundedText).max(12).default([]),
  successCriteria: z.array(boundedText).min(1).max(8),
  routingSummary: z.string().trim().min(8).max(400).describe('Concise user-facing routing summary; never private chain-of-thought.'),
  context: z.record(z.unknown()).default({}).describe('Bounded operational facts only; never identity, permissions, credentials, or approval authority.'),
};

const controlTowerInput = z.object({
  ...commonHandoffInput,
  workflow: z.literal('CONTROL_TOWER'),
  targetAgentId: z.literal('inventory-procurement-agent'),
  operation: z.literal('get_control_tower_summary'),
  resolvedEntities: z.object({}).strict().default({}),
}).strict();

const inventoryShortageInput = z.object({
  ...commonHandoffInput,
  workflow: z.literal('INVENTORY_SHORTAGE'),
  targetAgentId: z.literal('inventory-procurement-agent'),
  operation: z.enum(['analyze_inventory_shortage', 'prepare_internal_transfer', 'prepare_rfq']),
  resolvedEntities: z.object({ requirementId: z.string().trim().min(1).max(120).optional() }).strict().default({}),
}).strict();

const procurementInput = z.object({
  ...commonHandoffInput,
  workflow: z.literal('PROCUREMENT'),
  targetAgentId: z.literal('inventory-procurement-agent'),
  operation: z.enum(['compare_supplier_quotes', 'prepare_purchase_order']),
  resolvedEntities: z.object({
    requirementId: z.string().trim().min(1).max(120).optional(),
    rfqId: z.string().trim().min(1).max(120).optional(),
  }).strict().default({}),
}).strict();

const workforceGapInput = z.object({
  ...commonHandoffInput,
  workflow: z.literal('WORKFORCE_GAP'),
  targetAgentId: z.literal('workforce-coordinator'),
  operation: z.enum(['analyze_staffing_gap', 'prepare_staff_reassignment']),
  resolvedEntities: z.object({ shiftId: z.string().trim().min(1).max(120).optional() }).strict().default({}),
}).strict();

const workforceRosterInput = z.object({
  ...commonHandoffInput,
  workflow: z.literal('WORKFORCE_ROSTER'),
  targetAgentId: z.literal('workforce-coordinator'),
  operation: z.enum(['build_weekly_roster_plan', 'prepare_weekly_roster']),
  resolvedEntities: z.object({
    locationId: z.string().trim().min(1).max(120).optional(),
    weekStart: weekStartSchema.optional(),
  }).strict().default({}),
}).strict();

export const careFlowHandoffInputSchema = z.discriminatedUnion('workflow', [
  controlTowerInput,
  inventoryShortageInput,
  procurementInput,
  workforceGapInput,
  workforceRosterInput,
]);

export type CareFlowWorkflow = (typeof careFlowWorkflows)[number];
export type HandoffState = (typeof handoffStates)[number];
export type HandoffRisk = (typeof handoffRisks)[number];
export type CareFlowHandoffInput = z.infer<typeof careFlowHandoffInputSchema>;

export type ResolvedEntities = {
  requirementId?: string;
  shiftId?: string;
  locationId?: string;
  weekStart?: string;
  rfqId?: string;
};

export type CareFlowHandoff = {
  requestId: string;
  idempotencyKey: string;
  workflow: CareFlowWorkflow;
  userGoal: string;
  targetAgentId: CareFlowSpecialistId;
  operation: string;
  resolvedEntities: ResolvedEntities;
  constraints: string[];
  successCriteria: string[];
  routingSummary: string;
  context: Record<string, unknown>;
  allowedTools: string[];
  risk: HandoffRisk;
  approvalBoundary: string;
  missingInformation: string[];
  nextTool: string | null;
  specialistPromptName: string;
  status: HandoffState;
  auditEventId: string;
  createdAt: string;
  updatedAt: string;
};

export type CareFlowOperation = {
  name: string;
  description: string;
  toolName: string;
  risk: HandoffRisk;
  approvalBoundary: string;
  available: boolean;
  unavailableReason: string | null;
};

export type CareFlowSpecialistId =
  | 'inventory-procurement-agent'
  | 'workforce-coordinator';

export type CareFlowSpecialist = {
  id: CareFlowSpecialistId;
  name: string;
  description: string;
  specialistPromptName: string;
  status: 'available' | 'unavailable';
  unavailableReason: string | null;
  operations: CareFlowOperation[];
};

export type HandoffIdentity = {
  subject: string;
  organizationId: string;
  actorType: 'USER' | 'SERVICE' | 'DEMO';
  executionRequestId: string;
  roles: string[];
  scopes: string[];
};

export type ListCareFlowHandoffsInput = {
  workflow?: CareFlowWorkflow;
  status?: HandoffState;
  limit: number;
  cursor?: string;
};

export type ListCareFlowHandoffsResult = {
  handoffs: CareFlowHandoff[];
  nextCursor: string | null;
};

export class CareFlowOrchestratorError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CareFlowOrchestratorError';
  }
}
