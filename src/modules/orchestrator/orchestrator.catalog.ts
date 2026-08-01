import type {
  CareFlowOperation,
  CareFlowSpecialist,
  CareFlowSpecialistId,
  CareFlowWorkflow,
  HandoffRisk,
} from './orchestrator.types.js';

type OperationDefinition = Omit<CareFlowOperation, 'available' | 'unavailableReason'>;

const operationDefinitions: Record<string, OperationDefinition> = {
  get_control_tower_summary: operation(
    'get_control_tower_summary', 'Read the current CareFlow operations control-tower summary.', 'READ_ONLY',
    'The summary is read-only and cannot prepare, approve, or execute operational actions.',
  ),
  analyze_inventory_shortage: operation(
    'analyze_inventory_shortage', 'Analyze a known inventory shortage using authoritative CareFlow records.', 'READ_ONLY',
    'Analysis is read-only and cannot reserve, transfer, or purchase stock.',
  ),
  prepare_internal_transfer: operation(
    'prepare_internal_transfer', 'Prepare an internal stock transfer for a known requirement.', 'DRAFT',
    'Creates a reviewable prepared action only; it cannot move inventory or approve itself.',
  ),
  prepare_rfq: operation(
    'prepare_rfq', 'Prepare a supplier RFQ for a known procurement gap.', 'DRAFT',
    'Creates a reviewable RFQ action only; sending externally requires governance approval.',
  ),
  compare_supplier_quotes: operation(
    'compare_supplier_quotes', 'Compare supplier quotes for a known RFQ using deterministic records.', 'READ_ONLY',
    'Comparison is read-only and cannot select a supplier or place an order.',
  ),
  prepare_purchase_order: operation(
    'prepare_purchase_order', 'Prepare a purchase order from an approved procurement choice.', 'DRAFT',
    'Creates a prepared action only; approval and execution remain separate governance steps.',
  ),
  analyze_staffing_gap: operation(
    'analyze_staffing_gap', 'Analyze a known shift coverage gap without making clinical decisions.', 'READ_ONLY',
    'Analysis is operational only and cannot alter staff assignments.',
  ),
  prepare_staff_reassignment: operation(
    'prepare_staff_reassignment', 'Prepare a reassignment proposal for a known shift.', 'DRAFT',
    'Creates a reviewable proposal only; it cannot publish or approve a roster change.',
  ),
  build_weekly_roster_plan: operation(
    'build_weekly_roster_plan', 'Build a read-only weekly roster plan for a known location and Monday week start.', 'READ_ONLY',
    'Planning is read-only and cannot publish, approve, or change staff assignments.',
  ),
  prepare_weekly_roster: operation(
    'prepare_weekly_roster', 'Prepare a reviewable weekly roster action for a known location and Monday week start.', 'DRAFT',
    'Creates a prepared action only; it cannot publish, approve, or execute a roster change.',
  ),
};

function operation(name: string, description: string, risk: HandoffRisk, approvalBoundary: string): OperationDefinition {
  return { name, description, toolName: name, risk, approvalBoundary };
}

const specialistDefinitions: Array<Omit<CareFlowSpecialist, 'status' | 'unavailableReason' | 'operations'> & { operationNames: string[] }> = [
  {
    id: 'inventory-procurement-agent',
    name: 'Inventory & Procurement',
    description: 'Analyzes shortages and prepares governed transfer, RFQ, quote-comparison, and purchase-order work.',
    specialistPromptName: 'careflow_inventory_procurement_specialist',
    operationNames: ['get_control_tower_summary', 'analyze_inventory_shortage', 'prepare_internal_transfer', 'prepare_rfq', 'compare_supplier_quotes', 'prepare_purchase_order'],
  },
  {
    id: 'workforce-coordinator',
    name: 'Workforce Coordinator',
    description: 'Analyzes staffing gaps and builds or prepares weekly roster plans from authoritative workforce records.',
    specialistPromptName: 'careflow_workforce_coordinator',
    operationNames: ['analyze_staffing_gap', 'prepare_staff_reassignment', 'build_weekly_roster_plan', 'prepare_weekly_roster'],
  },
];

export const workflowRoutes: Record<CareFlowWorkflow, { specialistId: CareFlowSpecialistId; operations: string[] }> = {
  CONTROL_TOWER: { specialistId: 'inventory-procurement-agent', operations: ['get_control_tower_summary'] },
  INVENTORY_SHORTAGE: { specialistId: 'inventory-procurement-agent', operations: ['analyze_inventory_shortage', 'prepare_internal_transfer', 'prepare_rfq'] },
  PROCUREMENT: { specialistId: 'inventory-procurement-agent', operations: ['compare_supplier_quotes', 'prepare_purchase_order'] },
  WORKFORCE_GAP: { specialistId: 'workforce-coordinator', operations: ['analyze_staffing_gap', 'prepare_staff_reassignment'] },
  WORKFORCE_ROSTER: { specialistId: 'workforce-coordinator', operations: ['build_weekly_roster_plan', 'prepare_weekly_roster'] },
};

export function buildCareFlowCatalog(integratedTools: ReadonlySet<string>): CareFlowSpecialist[] {
  return specialistDefinitions.map((specialist) => {
    const operations = specialist.operationNames.map((name): CareFlowOperation => {
      const definition = operationDefinitions[name];
      const available = integratedTools.has(definition.toolName);
      return {
        ...definition,
        available,
        unavailableReason: available ? null : `${definition.toolName} has no verified registered provider in this deployment.`,
      };
    });
    const available = operations.some((candidate) => candidate.available);
    return {
      id: specialist.id,
      name: specialist.name,
      description: specialist.description,
      specialistPromptName: specialist.specialistPromptName,
      status: available ? 'available' : 'unavailable',
      unavailableReason: available ? null : 'None of this specialist\'s domain tools are verified as registered.',
      operations,
    };
  });
}

export function getOperation(
  workflow: CareFlowWorkflow,
  specialistId: CareFlowSpecialistId,
  operationName: string,
  integratedTools: ReadonlySet<string>,
): { specialist: CareFlowSpecialist; operation: CareFlowOperation } | null {
  const route = workflowRoutes[workflow];
  if (route.specialistId !== specialistId || !route.operations.includes(operationName)) return null;
  const specialist = buildCareFlowCatalog(integratedTools).find((candidate) => candidate.id === specialistId);
  const operation = specialist?.operations.find((candidate) => candidate.name === operationName);
  return specialist && operation ? { specialist, operation } : null;
}

export const orchestrationPolicy = {
  version: '2.0.0',
  maximumRecommendedSteps: 6,
  executionModel: 'NitroChat classifies requests and chains MCP tools sequentially from authoritative results.',
  rules: [
    'Create one handoff only after resolving the stable identifier required by the selected workflow.',
    'Call only the nextTool returned by a READY handoff.',
    'Create sequential handoffs only after the previous tool result is known; dependency execution is not advertised.',
    'Prepared actions never approve themselves, and routing never grants approval authority.',
    'A routing event is observability only and is never proof that a specialist ran.',
    'Never store or reveal private chain-of-thought.',
  ],
};
