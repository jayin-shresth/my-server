import { Injectable } from '@nitrostack/core';
import { WorkforcePolicyEvaluator, longestConsecutiveNightRun, longestConsecutiveShiftRun } from './workforce.policy.js';
import { WorkforceRepository, type PersistedDraft, type WorkforcePreparedActionRecord, type WorkforceShiftRecord } from './workforce.repository.js';
import { WorkforceRosterPlanner } from './workforce.planner.js';
import {
  WorkforceError,
  parseRosterWeekStart,
  rosterWeekEnd,
  type CandidateEvaluationResultDto,
  type PreparedActionDto,
  type SafeAssignment,
  type ShiftCoverageDto,
  type StaffingGapAnalysisDto,
  type StaffWorkloadDto,
  type WeeklyRosterDto,
  type WeeklyRosterPlanDto,
  type WorkforceIdentity,
  type PrepareReassignmentInput,
  type PrepareRosterInput,
} from './workforce.types.js';

const RANKING_POLICY = [
  'current weekly minutes ascending',
  'home-location match preferred',
  'recent shift-type continuity preferred',
  'consecutive-shift count ascending',
  'employee code ascending',
];

function localDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return sanitize(parsed) as Record<string, unknown>;
  } catch {
    throw new WorkforceError('WORKFORCE_DATA_INVALID', 'Persisted workforce JSON could not be read safely.');
  }
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(?:email|password|secret|token|authorization|cookie|credential)/i.test(key))
      .map(([key, child]) => [key, sanitize(child)]),
  );
}

function safeAssignment(assignment: WorkforceShiftRecord['assignments'][number]): SafeAssignment {
  return {
    assignmentId: assignment.id,
    assignmentCode: assignment.code,
    status: assignment.status,
    source: assignment.source,
    staff: {
      staffId: assignment.staffProfile.id,
      userId: assignment.staffProfile.userId,
      employeeCode: assignment.staffProfile.user.employeeCode,
      displayName: assignment.staffProfile.user.displayName,
      staffType: assignment.staffProfile.staffType,
      homeLocationId: assignment.staffProfile.homeLocationId,
    },
  };
}

function shiftDto(shift: WorkforceShiftRecord, location: { id: string; code: string; name: string }): ShiftCoverageDto {
  const assignments = [...shift.assignments].sort((left, right) => left.code.localeCompare(right.code)).map(safeAssignment);
  const confirmedCoverage = assignments.filter((assignment) => assignment.status === 'CONFIRMED').length;
  const absentCoverage = assignments.filter((assignment) => assignment.status === 'ABSENT').length;
  const proposedCoverage = assignments.filter((assignment) => assignment.status === 'DRAFT').length;
  return {
    shiftId: shift.id,
    shiftCode: shift.code,
    location,
    rosterWeekStart: localDate(shift.rosterWeekStart),
    shiftType: shift.shiftType,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    status: shift.status,
    requiredStaffType: shift.requiredStaffType,
    requiredSkills: [shift.requiredSkillCode],
    requiredHeadcount: shift.requiredHeadcount,
    confirmedCoverage,
    absentCoverage,
    proposedCoverage,
    gapSize: Math.max(0, shift.requiredHeadcount - confirmedCoverage),
    assignments,
  };
}

@Injectable({ deps: [WorkforceRepository, WorkforcePolicyEvaluator, WorkforceRosterPlanner] })
export class WorkforceService {
  constructor(
    private readonly repository: WorkforceRepository,
    private readonly policy: WorkforcePolicyEvaluator,
    private readonly planner: WorkforceRosterPlanner,
  ) {}

  async getWeeklyRoster(locationId: string, weekStart: string, identity: WorkforceIdentity): Promise<WeeklyRosterDto> {
    const parsedWeekStart = parseRosterWeekStart(weekStart);
    const [location, records] = await Promise.all([
      this.repository.getLocation(identity.organizationId, locationId),
      this.repository.getRoster(identity.organizationId, locationId, parsedWeekStart),
    ]);
    const shifts = records.map((record) => shiftDto(record, location));
    return {
      location,
      week: { startsOn: weekStart, endsOn: rosterWeekEnd(weekStart) },
      shifts,
      summary: {
        totalShifts: shifts.length,
        requiredPositions: shifts.reduce((total, shift) => total + shift.requiredHeadcount, 0),
        confirmedCoverage: shifts.reduce((total, shift) => total + shift.confirmedCoverage, 0),
        absentCoverage: shifts.reduce((total, shift) => total + shift.absentCoverage, 0),
        proposedCoverage: shifts.reduce((total, shift) => total + shift.proposedCoverage, 0),
        openPositions: shifts.reduce((total, shift) => total + shift.gapSize, 0),
      },
    };
  }

  async getUnfilledShifts(locationId: string, weekStart: string, identity: WorkforceIdentity) {
    const parsedWeekStart = parseRosterWeekStart(weekStart);
    const [location, gaps] = await Promise.all([
      this.repository.getLocation(identity.organizationId, locationId),
      this.repository.getUnfilled(identity.organizationId, locationId, parsedWeekStart),
    ]);
    const shifts = await Promise.all(gaps.map((gap) => this.repository.getShift(identity.organizationId, gap.shiftId)));
    return shifts.map((shift) => shiftDto(shift, location)).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  async getShiftCoverage(shiftId: string, identity: WorkforceIdentity): Promise<ShiftCoverageDto> {
    const shift = await this.repository.getShift(identity.organizationId, shiftId);
    const location = await this.repository.getLocation(identity.organizationId, shift.locationId);
    return shiftDto(shift, location);
  }

  async getStaffWeeklyWorkload(staffId: string, weekStart: string, identity: WorkforceIdentity): Promise<StaffWorkloadDto> {
    const record = await this.repository.getWorkload(identity.organizationId, staffId, parseRosterWeekStart(weekStart));
    const assignments = record.workload.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      shiftId: assignment.shiftId,
      shiftCode: assignment.shift.code,
      shiftType: assignment.shift.shiftType,
      locationId: assignment.shift.locationId,
      startsAt: assignment.shift.startsAt.toISOString(),
      endsAt: assignment.shift.endsAt.toISOString(),
      status: assignment.status,
    }));
    const intervals = record.workload.assignments.map((assignment) => assignment.shift);
    return {
      staff: {
        staffId: record.profile.id,
        userId: record.profile.userId,
        employeeCode: record.profile.user.employeeCode,
        displayName: record.profile.user.displayName,
        staffType: record.profile.staffType,
        homeLocationId: record.profile.homeLocationId,
      },
      week: { startsOn: weekStart, endsOn: rosterWeekEnd(weekStart) },
      assignedMinutes: record.workload.scheduledMinutes,
      assignedHours: record.workload.scheduledMinutes / 60,
      shiftCount: record.workload.assignmentCount,
      consecutiveShifts: longestConsecutiveShiftRun(intervals),
      consecutiveNightShifts: longestConsecutiveNightRun(intervals),
      assignments,
      approvedUnavailability: record.profile.unavailability.map((item) => ({
        id: item.id,
        code: item.code,
        type: item.unavailabilityType,
        startsAt: item.startsAt.toISOString(),
        endsAt: item.endsAt.toISOString(),
      })),
    };
  }

  async evaluateReplacementCandidates(shiftId: string, identity: WorkforceIdentity): Promise<CandidateEvaluationResultDto> {
    const [shift, snapshots] = await Promise.all([
      this.getShiftCoverage(shiftId, identity),
      this.repository.getCandidateSnapshots(identity.organizationId, shiftId),
    ]);
    const candidates = this.policy.evaluateCandidates(snapshots);
    return {
      shift,
      candidates,
      recommendedCandidate: candidates.find((candidate) => candidate.recommended) ?? null,
      rankingPolicy: RANKING_POLICY,
    };
  }

  async analyzeStaffingGap(shiftId: string, identity: WorkforceIdentity): Promise<StaffingGapAnalysisDto> {
    const evaluation = await this.evaluateReplacementCandidates(shiftId, identity);
    const rejected = evaluation.candidates.filter((candidate) => !candidate.eligible);
    const explanation = evaluation.shift.gapSize === 0
      ? `${evaluation.shift.shiftCode} has no confirmed coverage gap.`
      : evaluation.recommendedCandidate
        ? `${evaluation.shift.shiftCode} has ${evaluation.shift.gapSize} open position. ${evaluation.recommendedCandidate.employeeCode} is the highest-ranked eligible replacement; ${rejected.length} candidates were rejected by deterministic hard rules.`
        : `${evaluation.shift.shiftCode} has ${evaluation.shift.gapSize} open position and no eligible replacement candidate.`;
    return {
      gap: evaluation.shift,
      evaluatedCandidates: evaluation.candidates,
      recommendedCandidate: evaluation.recommendedCandidate,
      explanation,
      evidenceReferences: [
        `shift:${evaluation.shift.shiftId}`,
        ...evaluation.candidates.map((candidate) => `staff:${candidate.staffId}`),
      ],
      nextPermittedAction: evaluation.shift.gapSize === 0
        ? 'NO_GAP'
        : evaluation.recommendedCandidate ? 'PREPARE_STAFF_REASSIGNMENT' : 'NO_ELIGIBLE_CANDIDATE',
    };
  }

  async buildWeeklyRosterPlan(locationId: string, weekStart: string, identity: WorkforceIdentity): Promise<WeeklyRosterPlanDto> {
    const record = await this.repository.buildPlan(identity.organizationId, locationId, parseRosterWeekStart(weekStart));
    const plan = this.planner.present(record);
    const failedRules = plan.ruleChecks.filter((check) => !check.passed);
    if (failedRules.length) {
      throw new WorkforceError('ROSTER_PLAN_INVALID', `The authoritative roster plan failed: ${failedRules.map((check) => check.rule).join(', ')}.`);
    }
    return plan;
  }

  async prepareStaffReassignment(input: PrepareReassignmentInput, identity: WorkforceIdentity): Promise<PreparedActionDto> {
    const analysis = await this.analyzeStaffingGap(input.shiftId, identity);
    if (analysis.gap.gapSize === 0) throw new WorkforceError('STALE_STAFFING_GAP', 'The shift no longer has a confirmed coverage gap.');
    const candidate = analysis.evaluatedCandidates.find((item) => item.staffId === input.candidateStaffId);
    if (!candidate) throw new WorkforceError('CANDIDATE_NOT_FOUND', `No plausible candidate was found for ${input.candidateStaffId}.`);
    if (!candidate.eligible) {
      throw new WorkforceError('CANDIDATE_INELIGIBLE', `The candidate is ineligible: ${candidate.reasonCodes.join(', ')}.`);
    }
    const draft = await this.repository.createPreparedAction({
      actionType: 'REASSIGN_SHIFT',
      workflowType: 'WORKFORCE_GAP',
      targetType: 'SHIFT',
      targetId: input.shiftId,
      idempotencyKey: input.idempotencyKey,
      rationaleSummary: input.rationaleSummary,
      payload: {
        shiftId: input.shiftId,
        candidateStaffId: candidate.staffId,
        candidateUserId: candidate.userId,
        preserveAbsentAssignments: true,
      },
      evidence: {
        summary: [analysis.explanation, `${candidate.employeeCode}: ${candidate.currentWeeklyMinutes} -> ${candidate.resultingWeeklyMinutes} minutes.`],
        coverage: { confirmed: analysis.gap.confirmedCoverage, required: analysis.gap.requiredHeadcount, gapSize: analysis.gap.gapSize },
        candidateEvaluation: candidate,
      },
    }, identity);
    return this.mapDraft(draft);
  }

  async prepareWeeklyRoster(input: PrepareRosterInput, identity: WorkforceIdentity): Promise<PreparedActionDto> {
    const plan = await this.buildWeeklyRosterPlan(input.locationId, input.weekStart, identity);
    if (plan.planHash !== input.expectedPlanHash) {
      throw new WorkforceError('STALE_PLAN', 'The expected plan hash no longer matches the authoritative server-side roster plan.');
    }
    const draft = await this.repository.createPreparedAction({
      actionType: 'PUBLISH_ROSTER',
      workflowType: 'WORKFORCE_ROSTER',
      targetType: 'ROSTER_WEEK',
      targetId: `${input.locationId}:${input.weekStart}`,
      idempotencyKey: input.idempotencyKey,
      rationaleSummary: input.rationaleSummary,
      payload: {
        locationId: input.locationId,
        weekStart: input.weekStart,
        planHash: plan.planHash,
        proposedAssignments: plan.proposedAssignments.map((assignment) => ({ shiftId: assignment.shiftId, staffId: assignment.staffId })),
      },
      evidence: {
        summary: [`Deterministic plan ${plan.planHash} contains ${plan.proposedAssignments.length} proposed assignments.`, 'No ShiftAssignment records were created.'],
        ruleChecks: plan.ruleChecks,
        workloadDistribution: plan.workloadDistribution,
      },
    }, identity);
    return this.mapDraft(draft);
  }

  async getPreparedAction(preparedActionId: string, identity: WorkforceIdentity): Promise<PreparedActionDto> {
    const action = await this.repository.getPreparedAction(identity.organizationId, preparedActionId);
    const policy = await this.repository.getApprovalPolicy(action.actionType);
    const auditReferences = await this.repository.getAuditReferences(identity.organizationId, action.id);
    return this.mapPrepared(action, policy, auditReferences);
  }

  private mapDraft(draft: PersistedDraft): PreparedActionDto {
    return this.mapPrepared(draft.action, draft.policy, [draft.auditEventId]);
  }

  private mapPrepared(
    action: WorkforcePreparedActionRecord,
    policy: PersistedDraft['policy'],
    auditReferences: string[],
  ): PreparedActionDto {
    if (action.actionType !== 'REASSIGN_SHIFT' && action.actionType !== 'PUBLISH_ROSTER') {
      throw new WorkforceError('PREPARED_ACTION_NOT_FOUND', `Prepared action ${action.id} is not a workforce action.`);
    }
    const evidence = safeJson(action.evidenceJson);
    const payload = safeJson(action.payloadJson);
    const summary = Array.isArray(evidence.summary) ? evidence.summary.filter((item): item is string => typeof item === 'string') : [];
    return {
      preparedActionId: action.id,
      workflowRunId: action.workflowRunId,
      actionType: action.actionType,
      status: action.status,
      action: {
        targetType: action.targetType,
        targetId: action.targetId,
        preparedAt: action.preparedAt.toISOString(),
        rationaleSummary: action.reasoningSummary,
        payload,
      },
      evidence,
      approvalRequirement: {
        required: true,
        policyId: policy.id,
        policyCode: policy.code,
        requiredRoleCode: policy.requiredRoleCode,
        requiredApprovals: policy.requiredApprovals,
      },
      evidenceSummary: summary,
      approvalState: action.approvalRequests.length ? action.approvalRequests.map((request) => request.status).join(',') : 'NOT_REQUESTED',
      executionState: action.executions.length ? action.executions.map((execution) => execution.status).join(',') : 'NOT_STARTED',
      auditReferences,
    };
  }
}
