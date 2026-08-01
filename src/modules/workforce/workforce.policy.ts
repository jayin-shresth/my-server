import { Injectable } from '@nitrostack/core';
import type { ReplacementCandidateResult, ReplacementExclusionCode } from '../../data/workforce.js';
import type { CandidateEvaluationDto, PolicyEvidence, WorkforceReasonCode } from './workforce.types.js';

const MINUTES_PER_DAY = 1_440;
const INDIA_OFFSET_MINUTES = 330;

export type ShiftInterval = {
  shiftType: string;
  startsAt: Date;
  endsAt: Date;
};

export type CandidatePolicySnapshot = {
  candidate: ReplacementCandidateResult;
  activeEmployment: boolean;
  maxMinutesPerWeek: number;
  minRestMinutes: number;
  maxConsecutiveShifts: number;
  maxConsecutiveNightShifts: number;
};

export function durationMinutes(startsAt: Date, endsAt: Date): number {
  return Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
}

export function intervalsOverlap(
  existingStart: Date,
  existingEnd: Date,
  proposedStart: Date,
  proposedEnd: Date,
): boolean {
  return existingStart < proposedEnd && existingEnd > proposedStart;
}

export function restMinutesBetween(previousEnd: Date, nextStart: Date): number {
  return durationMinutes(previousEnd, nextStart);
}

function localDayIndex(date: Date): number {
  return Math.floor((date.getTime() + INDIA_OFFSET_MINUTES * 60_000) / (MINUTES_PER_DAY * 60_000));
}

export function longestConsecutiveShiftRun(shifts: readonly Pick<ShiftInterval, 'startsAt'>[]): number {
  const days = [...new Set(shifts.map((shift) => localDayIndex(shift.startsAt)))].sort((left, right) => left - right);
  let longest = 0;
  let current = 0;
  let previous: number | null = null;
  for (const day of days) {
    current = previous !== null && day === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

export function longestConsecutiveNightRun(shifts: readonly ShiftInterval[]): number {
  return longestConsecutiveShiftRun(shifts.filter((shift) => shift.shiftType === 'NIGHT'));
}

function normalizeReasons(reasons: readonly ReplacementExclusionCode[]): WorkforceReasonCode[] {
  const normalized: WorkforceReasonCode[] = [];
  const add = (reason: WorkforceReasonCode) => {
    if (!normalized.includes(reason)) normalized.push(reason);
  };
  for (const reason of reasons) {
    if (reason === 'INACTIVE_PROFILE' || reason === 'EMPLOYMENT_INACTIVE') add('INACTIVE_EMPLOYMENT');
    else if (reason === 'STAFF_TYPE_MISMATCH' || reason === 'MISSING_REQUIRED_SKILL' || reason === 'SKILL_EXPIRED') add('MISSING_REQUIRED_SKILL');
    else if (reason === 'ALREADY_ASSIGNED' || reason === 'SHIFT_OVERLAP') add('SHIFT_OVERLAP');
    else add(reason);
  }
  return normalized;
}

function evidence(snapshot: CandidatePolicySnapshot, reasons: readonly WorkforceReasonCode[]): PolicyEvidence[] {
  const { candidate } = snapshot;
  const passed = (reason: WorkforceReasonCode) => !reasons.includes(reason);
  return [
    { rule: 'INACTIVE_EMPLOYMENT', passed: snapshot.activeEmployment, actual: snapshot.activeEmployment },
    { rule: 'MISSING_REQUIRED_SKILL', passed: passed('MISSING_REQUIRED_SKILL'), actual: candidate.skillValidThroughShiftEnd },
    { rule: 'APPROVED_UNAVAILABILITY', passed: passed('APPROVED_UNAVAILABILITY'), actual: !passed('APPROVED_UNAVAILABILITY') },
    { rule: 'SHIFT_OVERLAP', passed: passed('SHIFT_OVERLAP'), actual: !passed('SHIFT_OVERLAP') },
    {
      rule: 'MAX_WEEKLY_MINUTES',
      passed: candidate.resultingMinutes <= snapshot.maxMinutesPerWeek,
      actual: candidate.resultingMinutes,
      limit: snapshot.maxMinutesPerWeek,
    },
    {
      rule: 'MINIMUM_REST',
      passed: passed('MINIMUM_REST'),
      actual: [candidate.restBeforeMinutes, candidate.restAfterMinutes].filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
      limit: snapshot.minRestMinutes,
    },
    {
      rule: 'MAX_CONSECUTIVE_SHIFTS',
      passed: candidate.consecutiveShiftCount <= snapshot.maxConsecutiveShifts,
      actual: candidate.consecutiveShiftCount,
      limit: snapshot.maxConsecutiveShifts,
    },
    {
      rule: 'MAX_CONSECUTIVE_NIGHTS',
      passed: candidate.consecutiveNightCount <= snapshot.maxConsecutiveNightShifts,
      actual: candidate.consecutiveNightCount,
      limit: snapshot.maxConsecutiveNightShifts,
    },
  ];
}

@Injectable()
export class WorkforcePolicyEvaluator {
  evaluateCandidates(snapshots: readonly CandidatePolicySnapshot[]): CandidateEvaluationDto[] {
    const evaluated = snapshots.map((snapshot) => {
      const reasons = normalizeReasons(snapshot.candidate.exclusionReasonCodes);
      if (!snapshot.activeEmployment && !reasons.includes('INACTIVE_EMPLOYMENT')) reasons.unshift('INACTIVE_EMPLOYMENT');
      const eligible = reasons.length === 0;
      return {
        snapshot,
        dto: {
          staffId: snapshot.candidate.staffProfileId,
          userId: snapshot.candidate.userId,
          employeeCode: snapshot.candidate.employeeCode,
          displayName: snapshot.candidate.displayName,
          eligible,
          reasonCodes: eligible ? ['ELIGIBLE' as const] : reasons,
          evidence: evidence(snapshot, reasons),
          currentWeeklyMinutes: snapshot.candidate.scheduledMinutes,
          currentWeeklyHours: snapshot.candidate.scheduledMinutes / 60,
          resultingWeeklyMinutes: snapshot.candidate.resultingMinutes,
          resultingWeeklyHours: snapshot.candidate.resultingMinutes / 60,
          homeLocationMatch: snapshot.candidate.homeLocationMatch,
          recentShiftTypeContinuity: snapshot.candidate.recentShiftTypeContinuity,
          consecutiveShiftCount: snapshot.candidate.consecutiveShiftCount,
          consecutiveNightShiftCount: snapshot.candidate.consecutiveNightCount,
          finalRank: null,
          recommended: false,
        } satisfies CandidateEvaluationDto,
      };
    });

    evaluated.sort((left, right) => {
      if (left.dto.eligible !== right.dto.eligible) return left.dto.eligible ? -1 : 1;
      if (left.dto.currentWeeklyMinutes !== right.dto.currentWeeklyMinutes) return left.dto.currentWeeklyMinutes - right.dto.currentWeeklyMinutes;
      if (left.dto.homeLocationMatch !== right.dto.homeLocationMatch) return left.dto.homeLocationMatch ? -1 : 1;
      if (left.dto.recentShiftTypeContinuity !== right.dto.recentShiftTypeContinuity) return left.dto.recentShiftTypeContinuity ? -1 : 1;
      if (left.dto.consecutiveShiftCount !== right.dto.consecutiveShiftCount) return left.dto.consecutiveShiftCount - right.dto.consecutiveShiftCount;
      return left.dto.employeeCode.localeCompare(right.dto.employeeCode);
    });

    let eligibleRank = 0;
    return evaluated.map(({ dto }) => {
      if (!dto.eligible) return dto;
      eligibleRank += 1;
      return { ...dto, finalRank: eligibleRank, recommended: eligibleRank === 1 };
    });
  }
}
