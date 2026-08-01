import { z } from '@nitrostack/core';

export const workforceReasonCodes = [
  'ELIGIBLE',
  'INACTIVE_EMPLOYMENT',
  'MISSING_REQUIRED_SKILL',
  'APPROVED_UNAVAILABILITY',
  'SHIFT_OVERLAP',
  'MAX_WEEKLY_MINUTES',
  'MINIMUM_REST',
  'MAX_CONSECUTIVE_SHIFTS',
  'MAX_CONSECUTIVE_NIGHTS',
] as const;

export type WorkforceReasonCode = (typeof workforceReasonCodes)[number];

function isValidRosterMonday(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) return false;
  const rosterMidnight = new Date(`${value}T00:00:00+05:30`);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(rosterMidnight) === 'Mon';
}

export const weekStartSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must use YYYY-MM-DD.')
  .refine(isValidRosterMonday, 'weekStart must be a real calendar date and Monday in Asia/Kolkata.');

export const stableIdSchema = z.string().trim().min(1).max(160);
export const idempotencyKeySchema = z.string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Use an opaque key containing letters, numbers, dots, colons, underscores, or hyphens.');

const sensitiveText = /(?:\b(?:password|passwd|secret|token|api[ _-]?key|authorization|cookie|credential)s?\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
const unsupportedText = /\b(?:diagnos(?:e|is|tic)|treatment advice|prescri(?:be|ption)|patient prognosis|forecast(?:ing)?|predict(?:ion|ive)?)\b/i;

export const publicRationaleSchema = z.string()
  .trim()
  .min(8)
  .max(400)
  .refine((value) => !sensitiveText.test(value), 'Public rationale must not contain credentials, secrets, tokens, or email addresses.')
  .refine((value) => !unsupportedText.test(value), 'CareFlow workforce actions cannot contain forecasting or clinical decision requests.');

export const locationWeekInputSchema = z.object({
  locationId: stableIdSchema,
  weekStart: weekStartSchema,
}).strict();

export const shiftInputSchema = z.object({ shiftId: stableIdSchema }).strict();
export const staffWorkloadInputSchema = z.object({
  staffId: stableIdSchema,
  weekStart: weekStartSchema,
}).strict();
export const preparedActionInputSchema = z.object({ preparedActionId: stableIdSchema }).strict();
export const prepareReassignmentInputSchema = z.object({
  shiftId: stableIdSchema,
  candidateStaffId: stableIdSchema,
  idempotencyKey: idempotencyKeySchema,
  rationaleSummary: publicRationaleSchema,
}).strict();
export const prepareRosterInputSchema = z.object({
  locationId: stableIdSchema,
  weekStart: weekStartSchema,
  expectedPlanHash: z.string().regex(/^wfplan_[a-f0-9]{64}$/, 'expectedPlanHash is invalid.'),
  idempotencyKey: idempotencyKeySchema,
  rationaleSummary: publicRationaleSchema,
}).strict();

export type LocationWeekInput = z.infer<typeof locationWeekInputSchema>;
export type PrepareReassignmentInput = z.infer<typeof prepareReassignmentInputSchema>;
export type PrepareRosterInput = z.infer<typeof prepareRosterInputSchema>;

export type WorkforceIdentity = {
  subject: string;
  organizationId: string;
  actorType: 'USER' | 'SERVICE' | 'DEMO';
  executionRequestId: string;
};

export type SafeLocation = {
  id: string;
  code: string;
  name: string;
};

export type SafeStaff = {
  staffId: string;
  userId: string;
  employeeCode: string;
  displayName: string;
  staffType: string;
  homeLocationId: string;
};

export type SafeAssignment = {
  assignmentId: string;
  assignmentCode: string;
  status: string;
  source: string;
  staff: SafeStaff;
};

export type ShiftCoverageDto = {
  shiftId: string;
  shiftCode: string;
  location: SafeLocation;
  rosterWeekStart: string;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  status: string;
  requiredStaffType: string;
  requiredSkills: string[];
  requiredHeadcount: number;
  confirmedCoverage: number;
  absentCoverage: number;
  proposedCoverage: number;
  gapSize: number;
  assignments: SafeAssignment[];
};

export type WeeklyRosterDto = {
  location: SafeLocation;
  week: { startsOn: string; endsOn: string };
  shifts: ShiftCoverageDto[];
  summary: {
    totalShifts: number;
    requiredPositions: number;
    confirmedCoverage: number;
    absentCoverage: number;
    proposedCoverage: number;
    openPositions: number;
  };
};

export type PolicyEvidence = {
  rule: WorkforceReasonCode;
  passed: boolean;
  actual: string | number | boolean | null;
  limit?: string | number | boolean;
};

export type CandidateEvaluationDto = {
  staffId: string;
  userId: string;
  employeeCode: string;
  displayName: string;
  eligible: boolean;
  reasonCodes: WorkforceReasonCode[];
  evidence: PolicyEvidence[];
  currentWeeklyMinutes: number;
  currentWeeklyHours: number;
  resultingWeeklyMinutes: number;
  resultingWeeklyHours: number;
  homeLocationMatch: boolean;
  recentShiftTypeContinuity: boolean;
  consecutiveShiftCount: number;
  consecutiveNightShiftCount: number;
  finalRank: number | null;
  recommended: boolean;
};

export type CandidateEvaluationResultDto = {
  shift: ShiftCoverageDto;
  candidates: CandidateEvaluationDto[];
  recommendedCandidate: CandidateEvaluationDto | null;
  rankingPolicy: string[];
};

export type StaffWorkloadDto = {
  staff: SafeStaff;
  week: { startsOn: string; endsOn: string };
  assignedMinutes: number;
  assignedHours: number;
  shiftCount: number;
  consecutiveShifts: number;
  consecutiveNightShifts: number;
  assignments: Array<{
    assignmentId: string;
    shiftId: string;
    shiftCode: string;
    shiftType: string;
    locationId: string;
    startsAt: string;
    endsAt: string;
    status: string;
  }>;
  approvedUnavailability: Array<{
    id: string;
    code: string;
    type: string;
    startsAt: string;
    endsAt: string;
  }>;
};

export type ProposedRosterAssignmentDto = {
  shiftId: string;
  shiftCode: string;
  staffId: string;
  userId: string;
  employeeCode: string;
  displayName: string;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
};

export type WeeklyRosterPlanDto = {
  location: SafeLocation;
  week: { startsOn: string; endsOn: string };
  proposedAssignments: ProposedRosterAssignmentDto[];
  workloadDistribution: Array<{
    staffId: string;
    employeeCode: string;
    currentMinutes: number;
    proposedMinutes: number;
    resultingMinutes: number;
    resultingHours: number;
    proposedShiftCount: number;
  }>;
  uncoveredSlots: Array<{ shiftId: string; shiftCode: string; remainingPositions: number }>;
  ruleChecks: Array<{ rule: string; passed: boolean; evidence: string }>;
  planHash: string;
  planningEvidence: string[];
};

export type StaffingGapAnalysisDto = {
  gap: ShiftCoverageDto;
  evaluatedCandidates: CandidateEvaluationDto[];
  recommendedCandidate: CandidateEvaluationDto | null;
  explanation: string;
  evidenceReferences: string[];
  nextPermittedAction: 'PREPARE_STAFF_REASSIGNMENT' | 'NO_ELIGIBLE_CANDIDATE' | 'NO_GAP';
};

export type PreparedActionDto = {
  preparedActionId: string;
  workflowRunId: string;
  actionType: 'REASSIGN_SHIFT' | 'PUBLISH_ROSTER';
  status: string;
  action: {
    targetType: string;
    targetId: string;
    preparedAt: string;
    rationaleSummary: string;
    payload: Record<string, unknown>;
  };
  evidence: Record<string, unknown>;
  approvalRequirement: {
    required: true;
    policyId: string;
    policyCode: string;
    requiredRoleCode: string;
    requiredApprovals: number;
  };
  evidenceSummary: string[];
  approvalState: string;
  executionState: string;
  auditReferences: string[];
};

export class WorkforceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WorkforceError';
  }
}

export function parseRosterWeekStart(value: string): Date {
  const parsed = weekStartSchema.safeParse(value);
  if (!parsed.success) throw new WorkforceError('INVALID_WEEK_START', parsed.error.issues[0]?.message ?? 'weekStart is invalid.');
  return new Date(`${value}T00:00:00+05:30`);
}

export function rosterWeekEnd(value: string): string {
  const date = parseRosterWeekStart(value);
  date.setUTCDate(date.getUTCDate() + 6);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
