import { ExecutionContext, ResourceDecorator as Resource } from '@nitrostack/core';

const policies = {
  version: '1.0.0',
  domainBoundary: 'Operational staffing only. No forecasting, prediction, diagnosis, prescribing, treatment recommendation, or clinical decision-making.',
  hardConstraints: {
    maximumWeeklyMinutes: 2_880,
    minimumRestMinutes: 660,
    activeEmploymentRequired: true,
    requiredSkillsMustMatch: true,
    approvedUnavailabilityBlocksAssignment: true,
    overlapRule: 'existingStart < proposedEnd && existingEnd > proposedStart',
    maximumConsecutiveShifts: 5,
    maximumConsecutiveNightShifts: 3,
  },
  rankingPolicy: [
    'current weekly minutes ascending',
    'home-location match preferred',
    'recent shift-type continuity preferred',
    'consecutive-shift count ascending',
    'employee code ascending',
  ],
  approvalBoundary: {
    coordinatorMay: ['read authoritative workforce state', 'calculate deterministic eligibility and plans', 'create reviewable prepared actions'],
    coordinatorMayNot: ['record approval', 'approve its own action', 'write final ShiftAssignment records', 'publish a roster', 'send notifications'],
  },
  reasonCodes: {
    ELIGIBLE: 'All hard rules passed.',
    INACTIVE_EMPLOYMENT: 'The staff profile, user, or employment state is inactive.',
    MISSING_REQUIRED_SKILL: 'The required dated skill or staff classification is not satisfied.',
    APPROVED_UNAVAILABILITY: 'An approved unavailable interval overlaps the proposed shift.',
    SHIFT_OVERLAP: 'An active assignment overlaps the proposed shift.',
    MAX_WEEKLY_MINUTES: 'Resulting assigned minutes exceed the staff weekly maximum.',
    MINIMUM_REST: 'An adjacent shift leaves less than the required rest interval.',
    MAX_CONSECUTIVE_SHIFTS: 'The proposed local-day run exceeds five consecutive shifts.',
    MAX_CONSECUTIVE_NIGHTS: 'The proposed local-day night run exceeds three consecutive night shifts.',
  },
};

const demoScenario = {
  organizationId: 'org-careflow-001',
  locationId: 'loc-04',
  publishedWeek: {
    weekStart: '2026-07-06',
    gapShiftId: 'shift-icu-20260709-day',
    gapShiftCode: 'SHIFT-ICU-20260709-DAY',
    expectedCoverage: { confirmed: 3, absent: 1, required: 4, gap: 1 },
    expectedRecommendedStaffId: 'staff-user-05',
    candidateStaffIds: ['staff-user-05', 'staff-user-06', 'staff-user-07', 'staff-user-08', 'staff-user-09'],
  },
  planningWeek: {
    weekStart: '2026-07-13',
    openShiftCount: 21,
    requiredHeadcountPerShift: 2,
    expectedProposedAssignments: 42,
  },
};

export class WorkforceResources {
  @Resource({
    uri: 'careflow://workforce/policies',
    name: 'CareFlow Workforce Policies',
    description: 'Deterministic workforce hard constraints, ranking policy, approval boundary, and public reason-code definitions.',
    mimeType: 'application/json',
    annotations: { audience: ['assistant'], priority: 1 },
  })
  async workforcePolicies(uri: string, ctx: ExecutionContext) {
    ctx.logger.info('Reading CareFlow workforce policies', { requestId: ctx.requestId });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(policies, null, 2) }] };
  }

  @Resource({
    uri: 'careflow://workforce/demo-scenario',
    name: 'CareFlow Workforce Demo Scenario',
    description: 'Stable organization, location, shift, staff, and roster-week identifiers for the deterministic ICU scenarios.',
    mimeType: 'application/json',
    annotations: { audience: ['assistant'], priority: 1 },
  })
  async workforceDemoScenario(uri: string, ctx: ExecutionContext) {
    ctx.logger.info('Reading CareFlow workforce demo identifiers', { requestId: ctx.requestId });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(demoScenario, null, 2) }] };
  }
}
