import { ExecutionContext, Injectable, ToolDecorator as Tool, Widget } from '@nitrostack/core';
import { WorkforceService } from './workforce.service.js';
import {
  WorkforceError,
  locationWeekInputSchema,
  prepareReassignmentInputSchema,
  prepareRosterInputSchema,
  preparedActionInputSchema,
  shiftInputSchema,
  staffWorkloadInputSchema,
  type LocationWeekInput,
  type PrepareReassignmentInput,
  type PrepareRosterInput,
  type WorkforceIdentity,
} from './workforce.types.js';

function claimString(ctx: ExecutionContext, name: string): string | null {
  const value = ctx.auth?.claims?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function workforceIdentityFromContext(ctx: ExecutionContext): WorkforceIdentity {
  const authenticatedSubject = ctx.auth?.subject?.trim();
  const configuredOrganization = process.env.CAREFLOW_ORGANIZATION_ID?.trim();
  if (authenticatedSubject) {
    const organizationId = claimString(ctx, 'organization_id') ?? claimString(ctx, 'tenant_id') ?? configuredOrganization;
    if (!organizationId) {
      throw new WorkforceError('ORGANIZATION_REQUIRED', 'The authenticated request needs an organization_id claim or CAREFLOW_ORGANIZATION_ID configuration.');
    }
    return {
      subject: authenticatedSubject,
      organizationId,
      actorType: ctx.auth?.clientId ? 'SERVICE' : 'USER',
      executionRequestId: ctx.requestId,
    };
  }
  const demoActor = process.env.CAREFLOW_DEMO_ACTOR_ID?.trim();
  if (!demoActor) throw new WorkforceError('AUTH_REQUIRED', 'An authenticated subject or CAREFLOW_DEMO_ACTOR_ID is required.');
  return {
    subject: demoActor,
    organizationId: process.env.CAREFLOW_DEMO_ORGANIZATION_ID?.trim() || configuredOrganization || 'org-careflow-001',
    actorType: 'DEMO',
    executionRequestId: ctx.requestId,
  };
}

function publicError(error: unknown, ctx: ExecutionContext): never {
  if (error instanceof WorkforceError) {
    ctx.logger.warn('CareFlow workforce request rejected', { requestId: ctx.requestId, code: error.code });
    throw new Error(`${error.code}: ${error.message}`);
  }
  ctx.logger.error('Unexpected CareFlow workforce failure', { requestId: ctx.requestId });
  throw new Error('CAREFLOW_WORKFORCE_INTERNAL_ERROR: The workforce coordinator could not complete the request safely.');
}

const readOnlyAnnotations = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false } as const;
const draftAnnotations = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false } as const;

@Injectable({ deps: [WorkforceService] })
export class WorkforceTools {
  constructor(private readonly service: WorkforceService) {}

  @Tool({
    name: 'get_weekly_roster',
    title: 'Get Weekly Workforce Roster',
    description: 'Read an organization-scoped published or open workforce roster with safe assignment and coverage DTOs.',
    inputSchema: locationWeekInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async getWeeklyRoster(input: LocationWeekInput, ctx: ExecutionContext) {
    try {
      return { view: 'weekly_roster', roster: await this.service.getWeeklyRoster(input.locationId, input.weekStart, workforceIdentityFromContext(ctx)) };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'get_unfilled_shifts',
    title: 'Get Unfilled Workforce Shifts',
    description: 'Read only shifts whose confirmed coverage is below required headcount, in deterministic chronological order.',
    inputSchema: locationWeekInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async getUnfilledShifts(input: LocationWeekInput, ctx: ExecutionContext) {
    try {
      const shifts = await this.service.getUnfilledShifts(input.locationId, input.weekStart, workforceIdentityFromContext(ctx));
      return { view: 'unfilled_shifts', shifts, totalGap: shifts.reduce((total, shift) => total + shift.gapSize, 0) };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'get_shift_coverage',
    title: 'Get Shift Coverage',
    description: 'Read confirmed, absent, proposed, and open coverage for one organization-scoped shift.',
    inputSchema: shiftInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async getShiftCoverage(input: { shiftId: string }, ctx: ExecutionContext) {
    try {
      return { view: 'shift_coverage', coverage: await this.service.getShiftCoverage(input.shiftId, workforceIdentityFromContext(ctx)) };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'get_staff_weekly_workload',
    title: 'Get Staff Weekly Workload',
    description: 'Read one staff profile workload across the requested roster week, including relevant approved unavailability.',
    inputSchema: staffWorkloadInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async getStaffWeeklyWorkload(input: { staffId: string; weekStart: string }, ctx: ExecutionContext) {
    try {
      return { view: 'staff_workload', workload: await this.service.getStaffWeeklyWorkload(input.staffId, input.weekStart, workforceIdentityFromContext(ctx)) };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'evaluate_replacement_candidates',
    title: 'Evaluate Replacement Candidates',
    description: 'Evaluate plausible replacement candidates with deterministic hard-rule evidence and lexicographic ranking.',
    inputSchema: shiftInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async evaluateReplacementCandidates(input: { shiftId: string }, ctx: ExecutionContext) {
    try {
      return { view: 'candidate_comparison', evaluation: await this.service.evaluateReplacementCandidates(input.shiftId, workforceIdentityFromContext(ctx)) };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'analyze_staffing_gap',
    title: 'Analyze Staffing Gap',
    description: 'Authoritatively analyze a known operational staffing gap, candidate workload, eligibility, and next permitted action without changing assignments.',
    inputSchema: shiftInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async analyzeStaffingGap(input: { shiftId: string }, ctx: ExecutionContext) {
    try {
      return { view: 'staffing_gap', analysis: await this.service.analyzeStaffingGap(input.shiftId, workforceIdentityFromContext(ctx)) };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'build_weekly_roster_plan',
    title: 'Build Weekly Workforce Roster Plan',
    description: 'Build a deterministic, constraint-checked weekly roster plan and reproducible hash without creating ShiftAssignment records.',
    inputSchema: locationWeekInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async buildWeeklyRosterPlan(input: LocationWeekInput, ctx: ExecutionContext) {
    try {
      return { view: 'weekly_roster_plan', plan: await this.service.buildWeeklyRosterPlan(input.locationId, input.weekStart, workforceIdentityFromContext(ctx)) };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'prepare_staff_reassignment',
    title: 'Prepare Staff Reassignment',
    description: 'Re-read and re-evaluate a replacement, then create only a reviewable REASSIGN_SHIFT workflow/action/audit draft. Never assigns, approves, publishes, or notifies.',
    inputSchema: prepareReassignmentInputSchema,
    annotations: draftAnnotations,
    invocation: { invoking: 'Rechecking workforce eligibility...', invoked: 'Reassignment draft prepared' },
  })
  @Widget('workforce-coordinator')
  async prepareStaffReassignment(input: PrepareReassignmentInput, ctx: ExecutionContext) {
    try {
      return { view: 'prepared_action', preparedAction: await this.service.prepareStaffReassignment(input, workforceIdentityFromContext(ctx)), boundary: 'Approval required' };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'prepare_weekly_roster',
    title: 'Prepare Weekly Workforce Roster',
    description: 'Rebuild and hash-check a roster plan, then create only a reviewable PUBLISH_ROSTER workflow/action/audit draft. Never creates assignments or publishes.',
    inputSchema: prepareRosterInputSchema,
    annotations: draftAnnotations,
    invocation: { invoking: 'Rebuilding workforce plan...', invoked: 'Roster publication draft prepared' },
  })
  @Widget('workforce-coordinator')
  async prepareWeeklyRoster(input: PrepareRosterInput, ctx: ExecutionContext) {
    try {
      return { view: 'prepared_action', preparedAction: await this.service.prepareWeeklyRoster(input, workforceIdentityFromContext(ctx)), boundary: 'Approval required' };
    } catch (error) { return publicError(error, ctx); }
  }

  @Tool({
    name: 'get_workforce_prepared_action',
    title: 'Get Workforce Prepared Action',
    description: 'Read the safe action, evidence, approval state, execution state, and audit references for a workforce prepared action.',
    inputSchema: preparedActionInputSchema,
    annotations: readOnlyAnnotations,
  })
  @Widget('workforce-coordinator')
  async getPreparedAction(input: { preparedActionId: string }, ctx: ExecutionContext) {
    try {
      return { view: 'prepared_action', preparedAction: await this.service.getPreparedAction(input.preparedActionId, workforceIdentityFromContext(ctx)), boundary: 'Approval required' };
    } catch (error) { return publicError(error, ctx); }
  }
}
