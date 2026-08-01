import { createHash } from 'node:crypto';
import { Injectable } from '@nitrostack/core';
import type { PlanRecord } from './workforce.repository.js';
import {
  durationMinutes,
  intervalsOverlap,
  longestConsecutiveNightRun,
  longestConsecutiveShiftRun,
  restMinutesBetween,
  type ShiftInterval,
} from './workforce.policy.js';
import type { WeeklyRosterPlanDto } from './workforce.types.js';

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

function planHash(record: PlanRecord): string {
  const assignments = [...record.plan.proposedAssignments]
    .map((assignment) => ({
      shiftId: assignment.shiftId,
      staffId: assignment.staffProfileId,
      startsAt: assignment.startsAt.toISOString(),
      endsAt: assignment.endsAt.toISOString(),
    }))
    .sort((left, right) => left.shiftId.localeCompare(right.shiftId) || left.staffId.localeCompare(right.staffId));
  const payload = canonicalize({
    locationId: record.location.id,
    weekStart: record.plan.weekStart.toISOString(),
    assignments,
  });
  return `wfplan_${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function noOverlap(shifts: readonly ShiftInterval[]): boolean {
  const ordered = [...shifts].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  return ordered.every((shift, index) => index === 0 || !intervalsOverlap(
    ordered[index - 1].startsAt,
    ordered[index - 1].endsAt,
    shift.startsAt,
    shift.endsAt,
  ));
}

function minimumRestSatisfied(shifts: readonly ShiftInterval[], minimumMinutes: number): boolean {
  const ordered = [...shifts].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  return ordered.every((shift, index) => index === 0 || (
    !intervalsOverlap(ordered[index - 1].startsAt, ordered[index - 1].endsAt, shift.startsAt, shift.endsAt)
    && restMinutesBetween(ordered[index - 1].endsAt, shift.startsAt) >= minimumMinutes
  ));
}

@Injectable()
export class WorkforceRosterPlanner {
  present(record: PlanRecord): WeeklyRosterPlanDto {
    const proposedAssignments = [...record.plan.proposedAssignments]
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.employeeCode.localeCompare(right.employeeCode))
      .map((assignment) => ({
        shiftId: assignment.shiftId,
        shiftCode: assignment.shiftCode,
        staffId: assignment.staffProfileId,
        userId: assignment.userId,
        employeeCode: assignment.employeeCode,
        displayName: assignment.displayName,
        shiftType: assignment.shiftType,
        startsAt: assignment.startsAt.toISOString(),
        endsAt: assignment.endsAt.toISOString(),
        durationMinutes: assignment.durationMinutes,
      }));

    const assignmentsByShift = new Map<string, number>();
    const assignmentsByStaff = new Map<string, typeof record.plan.proposedAssignments>();
    for (const assignment of record.plan.proposedAssignments) {
      assignmentsByShift.set(assignment.shiftId, (assignmentsByShift.get(assignment.shiftId) ?? 0) + 1);
      assignmentsByStaff.set(assignment.staffProfileId, [...(assignmentsByStaff.get(assignment.staffProfileId) ?? []), assignment]);
    }

    const uncoveredSlots = record.shifts.flatMap((shift) => {
      const remainingPositions = Math.max(0, shift.requiredHeadcount - (assignmentsByShift.get(shift.id) ?? 0));
      return remainingPositions ? [{ shiftId: shift.id, shiftCode: shift.code, remainingPositions }] : [];
    });

    const workloadDistribution = record.profiles
      .map((profile) => {
        const proposed = assignmentsByStaff.get(profile.id) ?? [];
        const proposedMinutes = proposed.reduce((total, assignment) => total + assignment.durationMinutes, 0);
        const currentMinutes = record.currentMinutes.get(profile.id) ?? 0;
        return {
          staffId: profile.id,
          employeeCode: profile.user.employeeCode,
          currentMinutes,
          proposedMinutes,
          resultingMinutes: currentMinutes + proposedMinutes,
          resultingHours: (currentMinutes + proposedMinutes) / 60,
          proposedShiftCount: proposed.length,
        };
      })
      .sort((left, right) => right.proposedMinutes - left.proposedMinutes || left.employeeCode.localeCompare(right.employeeCode));

    const activeEmploymentPassed = record.profiles.every((profile) => profile.active && profile.user.active && profile.employmentStatus === 'ACTIVE');
    const skillsPassed = record.profiles.every((profile) => (assignmentsByStaff.get(profile.id) ?? []).every((assignment) => {
      const shift = record.shifts.find((candidate) => candidate.id === assignment.shiftId);
      return Boolean(shift && profile.skills.some((skill) => (
        skill.skillCode === shift.requiredSkillCode
        && skill.active
        && skill.validFrom <= shift.startsAt
        && (skill.validUntil === null || skill.validUntil >= shift.endsAt)
      )));
    }));
    const unavailabilityPassed = record.profiles.every((profile) => (assignmentsByStaff.get(profile.id) ?? []).every((assignment) => (
      !profile.unavailability.some((item) => intervalsOverlap(item.startsAt, item.endsAt, assignment.startsAt, assignment.endsAt))
    )));
    const staffIntervals = (profileId: string): ShiftInterval[] => {
      const profile = record.profiles.find((candidate) => candidate.id === profileId);
      if (!profile) return [];
      return [
        ...profile.assignments.map((assignment) => assignment.shift),
        ...(assignmentsByStaff.get(profileId) ?? []).map((assignment) => ({
          shiftType: assignment.shiftType,
          startsAt: assignment.startsAt,
          endsAt: assignment.endsAt,
        })),
      ];
    };
    const overlapPassed = record.profiles.every((profile) => noOverlap(staffIntervals(profile.id)));
    const restPassed = record.profiles.every((profile) => minimumRestSatisfied(staffIntervals(profile.id), profile.minRestMinutes));
    const weeklyPassed = workloadDistribution.every((workload) => {
      const profile = record.profiles.find((candidate) => candidate.id === workload.staffId);
      return Boolean(profile && workload.resultingMinutes <= profile.maxMinutesPerWeek);
    });
    const consecutivePassed = record.profiles.every((profile) => longestConsecutiveShiftRun(staffIntervals(profile.id)) <= profile.maxConsecutiveShifts);
    const consecutiveNightsPassed = record.profiles.every((profile) => longestConsecutiveNightRun(staffIntervals(profile.id)) <= profile.maxConsecutiveNightShifts);

    return {
      location: record.location,
      week: {
        startsOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(record.plan.weekStart),
        endsOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(record.plan.weekStart.getTime() + 6 * 86_400_000)),
      },
      proposedAssignments,
      workloadDistribution,
      uncoveredSlots,
      ruleChecks: [
        { rule: 'COMPLETE_COVERAGE', passed: uncoveredSlots.length === 0 && proposedAssignments.length === record.plan.requiredSlots, evidence: `${proposedAssignments.length}/${record.plan.requiredSlots} required positions proposed.` },
        { rule: 'ACTIVE_EMPLOYMENT', passed: activeEmploymentPassed, evidence: `${record.profiles.length} proposed staff profiles checked.` },
        { rule: 'REQUIRED_SKILLS', passed: skillsPassed, evidence: 'Required dated skills were checked through each shift end.' },
        { rule: 'APPROVED_UNAVAILABILITY', passed: unavailabilityPassed, evidence: 'Approved unavailable intervals were checked with half-open overlap semantics.' },
        { rule: 'SHIFT_OVERLAP', passed: overlapPassed, evidence: 'Existing and proposed intervals were checked for overlap.' },
        { rule: 'MAX_WEEKLY_MINUTES', passed: weeklyPassed, evidence: 'Current plus proposed minutes were checked against each staff profile limit.' },
        { rule: 'MINIMUM_REST', passed: restPassed, evidence: 'Adjacent existing and proposed shifts were checked against each staff profile rest limit.' },
        { rule: 'MAX_CONSECUTIVE_SHIFTS', passed: consecutivePassed, evidence: 'Local roster-day runs were checked against each staff profile limit.' },
        { rule: 'MAX_CONSECUTIVE_NIGHTS', passed: consecutiveNightsPassed, evidence: 'Local night-shift runs were checked against each staff profile limit.' },
      ],
      planHash: planHash(record),
      planningEvidence: [
        'Authoritative inputs came from the organization-scoped workforce repository adapter.',
        'The database workforce planner selected assignments deterministically without writing ShiftAssignment records.',
        'Ranking order: weekly minutes, home-location match, shift-type continuity, consecutive shifts, employee code.',
        'The plan hash covers location, roster week, shift IDs, staff IDs, and assignment intervals in canonical order.',
      ],
    };
  }
}
