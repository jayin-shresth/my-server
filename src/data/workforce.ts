import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

const ACTIVE_ASSIGNMENT_STATUSES = ["DRAFT", "CONFIRMED"] as const;
const MINUTES_PER_DAY = 1_440;
const INDIA_OFFSET_MINUTES = 330;

export type ReplacementExclusionCode =
  | "INACTIVE_PROFILE"
  | "EMPLOYMENT_INACTIVE"
  | "STAFF_TYPE_MISMATCH"
  | "MISSING_REQUIRED_SKILL"
  | "SKILL_EXPIRED"
  | "APPROVED_UNAVAILABILITY"
  | "SHIFT_OVERLAP"
  | "MAX_WEEKLY_MINUTES"
  | "MINIMUM_REST"
  | "MAX_CONSECUTIVE_SHIFTS"
  | "MAX_CONSECUTIVE_NIGHTS"
  | "ALREADY_ASSIGNED";

type AssignmentWithShift = Prisma.ShiftAssignmentGetPayload<{ include: { shift: true } }>;

export interface ShiftCoverageResult {
  shiftId: string;
  shiftCode: string;
  requiredHeadcount: number;
  activeAssignmentCount: number;
  absentAssignmentCount: number;
  openPositions: number;
  fullyCovered: boolean;
}

export interface StaffWeeklyWorkloadResult {
  staffProfileId: string;
  weekStart: Date;
  scheduledMinutes: number;
  assignmentCount: number;
  assignments: readonly AssignmentWithShift[];
}

export interface ReplacementCandidateResult {
  staffProfileId: string;
  userId: string;
  employeeCode: string;
  displayName: string;
  eligible: boolean;
  exclusionReasonCodes: readonly ReplacementExclusionCode[];
  scheduledMinutes: number;
  resultingMinutes: number;
  restBeforeMinutes: number | null;
  restAfterMinutes: number | null;
  skillValidThroughShiftEnd: boolean;
  homeLocationMatch: boolean;
  recentShiftTypeContinuity: boolean;
  consecutiveShiftCount: number;
  consecutiveNightCount: number;
  deterministicRank: number;
  recommended: boolean;
}

export interface ProposedRosterAssignment {
  shiftId: string;
  shiftCode: string;
  staffProfileId: string;
  userId: string;
  employeeCode: string;
  displayName: string;
  shiftType: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  status: "DRAFT";
  source: "SCHEDULER";
}

export interface WeeklyRosterPlan {
  locationId: string;
  weekStart: Date;
  requiredSlots: number;
  proposedAssignments: readonly ProposedRosterAssignment[];
  distribution: Readonly<Record<string, number>>;
}

function durationMinutes(startsAt: Date, endsAt: Date): number {
  return Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
}

function overlaps(firstStart: Date, firstEnd: Date, secondStart: Date, secondEnd: Date): boolean {
  return firstStart < secondEnd && firstEnd > secondStart;
}

function localDayIndex(date: Date): number {
  return Math.floor((date.getTime() + INDIA_OFFSET_MINUTES * 60_000) / (MINUTES_PER_DAY * 60_000));
}

function consecutiveDayRunContaining(
  shifts: readonly { startsAt: Date }[],
  proposedShifts: readonly { startsAt: Date }[],
): number {
  const days = [...new Set(shifts.map((shift) => localDayIndex(shift.startsAt)))].sort((left, right) => left - right);
  const proposedDays = new Set(proposedShifts.map((shift) => localDayIndex(shift.startsAt)));
  let longestRelevantRun = 0;
  for (let index = 0; index < days.length;) {
    let end = index;
    while (end + 1 < days.length && days[end + 1] === days[end] + 1) end += 1;
    const run = days.slice(index, end + 1);
    if (run.some((day) => proposedDays.has(day))) longestRelevantRun = Math.max(longestRelevantRun, run.length);
    index = end + 1;
  }
  return longestRelevantRun;
}

function activeAssignments<T extends { status: string }>(assignments: readonly T[]): readonly T[] {
  return assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.some((status) => status === assignment.status));
}

function restAroundShift(
  assignments: readonly { status: string; shift: { startsAt: Date; endsAt: Date } }[],
  proposedStart: Date,
  proposedEnd: Date,
): { restBeforeMinutes: number | null; restAfterMinutes: number | null } {
  let restBeforeMinutes: number | null = null;
  let restAfterMinutes: number | null = null;
  for (const assignment of activeAssignments(assignments)) {
    if (assignment.shift.endsAt <= proposedStart) {
      const rest = durationMinutes(assignment.shift.endsAt, proposedStart);
      restBeforeMinutes = restBeforeMinutes === null ? rest : Math.min(restBeforeMinutes, rest);
    }
    if (assignment.shift.startsAt >= proposedEnd) {
      const rest = durationMinutes(proposedEnd, assignment.shift.startsAt);
      restAfterMinutes = restAfterMinutes === null ? rest : Math.min(restAfterMinutes, rest);
    }
  }
  return { restBeforeMinutes, restAfterMinutes };
}

export async function getWeeklyRoster(client: PrismaClient, organizationId: string, locationId: string, weekStart: Date) {
  await client.location.findFirstOrThrow({ where: { id: locationId, organizationId } });
  return client.shift.findMany({
    where: { organizationId, locationId, rosterWeekStart: weekStart },
    include: {
      assignments: {
        where: { staffProfile: { user: { is: { organizationId } } } },
        include: { staffProfile: { include: { user: true, skills: true } }, preparedAction: true },
        orderBy: { code: "asc" },
      },
    },
    orderBy: { startsAt: "asc" },
  });
}

export async function getShiftCoverage(client: PrismaClient, organizationId: string, shiftId: string): Promise<ShiftCoverageResult> {
  const shift = await client.shift.findFirstOrThrow({
    where: { id: shiftId, organizationId },
    include: { assignments: { where: { staffProfile: { user: { is: { organizationId } } } } } },
  });
  const activeAssignmentCount = shift.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.some((status) => status === assignment.status)).length;
  const absentAssignmentCount = shift.assignments.filter((assignment) => assignment.status === "ABSENT").length;
  const openPositions = Math.max(0, shift.requiredHeadcount - activeAssignmentCount);
  return {
    shiftId: shift.id,
    shiftCode: shift.code,
    requiredHeadcount: shift.requiredHeadcount,
    activeAssignmentCount,
    absentAssignmentCount,
    openPositions,
    fullyCovered: openPositions === 0,
  };
}

export async function getUnfilledShifts(client: PrismaClient, organizationId: string, locationId: string, weekStart: Date) {
  const shifts = await getWeeklyRoster(client, organizationId, locationId, weekStart);
  return Promise.all(
    shifts
      .filter((shift) => shift.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.some((status) => status === assignment.status)).length < shift.requiredHeadcount)
      .map((shift) => getShiftCoverage(client, organizationId, shift.id)),
  );
}

export async function getStaffWeeklyWorkload(
  client: PrismaClient,
  organizationId: string,
  staffProfileId: string,
  weekStart: Date,
): Promise<StaffWeeklyWorkloadResult> {
  await client.staffProfile.findFirstOrThrow({ where: { id: staffProfileId, user: { is: { organizationId } } } });
  const assignments = await client.shiftAssignment.findMany({
    where: {
      staffProfileId,
      staffProfile: { user: { is: { organizationId } } },
      status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
      shift: { organizationId, rosterWeekStart: weekStart },
    },
    include: { shift: true },
    orderBy: { shift: { startsAt: "asc" } },
  });
  return {
    staffProfileId,
    weekStart,
    scheduledMinutes: assignments.reduce((total, assignment) => total + durationMinutes(assignment.shift.startsAt, assignment.shift.endsAt), 0),
    assignmentCount: assignments.length,
    assignments,
  };
}

export async function evaluateReplacementCandidates(
  client: PrismaClient,
  organizationId: string,
  shiftId: string,
): Promise<readonly ReplacementCandidateResult[]> {
  const shift = await client.shift.findFirstOrThrow({ where: { id: shiftId, organizationId } });
  const profiles = await client.staffProfile.findMany({
    where: { user: { is: { organizationId } } },
    include: {
      user: true,
      skills: true,
      unavailability: true,
      assignments: { where: { shift: { organizationId } }, include: { shift: true } },
    },
  });

  const unranked = profiles.map((profile) => {
    const reasons: ReplacementExclusionCode[] = [];
    const profileAssignments = activeAssignments(profile.assignments);
    const weeklyAssignments = profileAssignments.filter((assignment) => assignment.shift.rosterWeekStart.getTime() === shift.rosterWeekStart.getTime());
    const scheduledMinutes = weeklyAssignments.reduce((total, assignment) => total + durationMinutes(assignment.shift.startsAt, assignment.shift.endsAt), 0);
    const shiftMinutes = durationMinutes(shift.startsAt, shift.endsAt);
    const resultingMinutes = scheduledMinutes + shiftMinutes;
    const requiredSkills = profile.skills.filter((skill) => skill.skillCode === shift.requiredSkillCode && skill.active);
    const skillValidThroughShiftEnd = requiredSkills.some(
      (skill) => skill.validFrom <= shift.startsAt && (skill.validUntil === null || skill.validUntil >= shift.endsAt),
    );
    const alreadyAssigned = profile.assignments.some(
      (assignment) => assignment.shiftId === shift.id && assignment.status !== "CANCELLED",
    );
    const hasOverlap = profileAssignments.some((assignment) =>
      overlaps(assignment.shift.startsAt, assignment.shift.endsAt, shift.startsAt, shift.endsAt),
    );
    const approvedUnavailable = profile.unavailability.some(
      (item) => item.status === "APPROVED" && overlaps(item.startsAt, item.endsAt, shift.startsAt, shift.endsAt),
    );
    const rest = restAroundShift(profile.assignments, shift.startsAt, shift.endsAt);
    const restViolation =
      (rest.restBeforeMinutes !== null && rest.restBeforeMinutes < profile.minRestMinutes) ||
      (rest.restAfterMinutes !== null && rest.restAfterMinutes < profile.minRestMinutes);
    const proposedShifts = [...profileAssignments.map((assignment) => assignment.shift), shift];
    const consecutiveShiftCount = consecutiveDayRunContaining(proposedShifts, [shift]);
    const consecutiveNightCount = shift.shiftType === "NIGHT"
      ? consecutiveDayRunContaining(proposedShifts.filter((item) => item.shiftType === "NIGHT"), [shift])
      : 0;

    if (!profile.active || !profile.user.active) reasons.push("INACTIVE_PROFILE");
    if (profile.employmentStatus !== "ACTIVE") reasons.push("EMPLOYMENT_INACTIVE");
    if (profile.staffType !== shift.requiredStaffType) reasons.push("STAFF_TYPE_MISMATCH");
    if (requiredSkills.length === 0) reasons.push("MISSING_REQUIRED_SKILL");
    else if (!skillValidThroughShiftEnd) reasons.push("SKILL_EXPIRED");
    if (approvedUnavailable) reasons.push("APPROVED_UNAVAILABILITY");
    if (hasOverlap) reasons.push("SHIFT_OVERLAP");
    if (resultingMinutes > profile.maxMinutesPerWeek) reasons.push("MAX_WEEKLY_MINUTES");
    if (restViolation) reasons.push("MINIMUM_REST");
    if (consecutiveShiftCount > profile.maxConsecutiveShifts) reasons.push("MAX_CONSECUTIVE_SHIFTS");
    if (consecutiveNightCount > profile.maxConsecutiveNightShifts) reasons.push("MAX_CONSECUTIVE_NIGHTS");
    if (alreadyAssigned) reasons.push("ALREADY_ASSIGNED");

    const latestPrevious = profileAssignments
      .filter((assignment) => assignment.shift.endsAt <= shift.startsAt)
      .sort((left, right) => right.shift.endsAt.getTime() - left.shift.endsAt.getTime())[0];
    return {
      staffProfileId: profile.id,
      userId: profile.userId,
      employeeCode: profile.user.employeeCode,
      displayName: profile.user.displayName,
      eligible: reasons.length === 0,
      exclusionReasonCodes: reasons,
      scheduledMinutes,
      resultingMinutes,
      restBeforeMinutes: rest.restBeforeMinutes,
      restAfterMinutes: rest.restAfterMinutes,
      skillValidThroughShiftEnd,
      homeLocationMatch: profile.homeLocationId === shift.locationId,
      recentShiftTypeContinuity: latestPrevious?.shift.shiftType === shift.shiftType,
      consecutiveShiftCount,
      consecutiveNightCount,
    };
  });

  const ranked = [...unranked].sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    if (left.scheduledMinutes !== right.scheduledMinutes) return left.scheduledMinutes - right.scheduledMinutes;
    if (left.homeLocationMatch !== right.homeLocationMatch) return left.homeLocationMatch ? -1 : 1;
    if (left.recentShiftTypeContinuity !== right.recentShiftTypeContinuity) return left.recentShiftTypeContinuity ? -1 : 1;
    if (left.consecutiveShiftCount !== right.consecutiveShiftCount) return left.consecutiveShiftCount - right.consecutiveShiftCount;
    return left.employeeCode.localeCompare(right.employeeCode);
  });
  return ranked.map((candidate, index) => ({
    ...candidate,
    deterministicRank: index + 1,
    recommended: candidate.eligible && index === 0,
  }));
}

function combinations<T>(values: readonly T[], size: number, start = 0, prefix: readonly T[] = []): readonly (readonly T[])[] {
  if (size === 0) return [prefix];
  const result: T[][] = [];
  for (let index = start; index <= values.length - size; index += 1) {
    result.push(...combinations(values, size - 1, index + 1, [...prefix, values[index]]).map((item) => [...item]));
  }
  return result;
}

export async function buildWeeklyRosterPlan(
  client: PrismaClient,
  organizationId: string,
  locationId: string,
  weekStart: Date,
): Promise<WeeklyRosterPlan> {
  const shifts = await client.shift.findMany({ where: { organizationId, locationId, rosterWeekStart: weekStart }, orderBy: { startsAt: "asc" } });
  if (shifts.length === 0) throw new Error("No shifts exist for the requested location and roster week");
  const activeExistingAssignments = await client.shiftAssignment.count({
    where: { shiftId: { in: shifts.map((shift) => shift.id) }, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
  });
  if (activeExistingAssignments > 0) throw new Error("Roster planner requires an unassigned planning week");

  const requiredStaffType = shifts[0].requiredStaffType;
  const requiredSkillCode = shifts[0].requiredSkillCode;
  const candidates = await client.staffProfile.findMany({
    where: {
      active: true,
      employmentStatus: "ACTIVE",
      staffType: requiredStaffType,
      user: { is: { organizationId, active: true } },
      skills: {
        some: {
          skillCode: requiredSkillCode,
          active: true,
          validFrom: { lte: shifts[0].startsAt },
          OR: [{ validUntil: null }, { validUntil: { gte: shifts[shifts.length - 1].endsAt } }],
        },
      },
    },
    include: {
      user: true,
      unavailability: { where: { status: "APPROVED" } },
      assignments: {
        where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] }, shift: { organizationId } },
        include: { shift: true },
      },
    },
    orderBy: { user: { employeeCode: "asc" } },
  });
  if (candidates.length === 0) throw new Error("No active staff satisfy the roster's staff-type and skill requirements");

  const requiredSlots = shifts.reduce((total, shift) => total + shift.requiredHeadcount, 0);
  const selected = new Map(candidates.map((candidate) => [candidate.id, [] as typeof shifts]));
  const assignmentsByShift = new Map<string, typeof candidates>(shifts.map((shift) => [shift.id, []]));

  const canAssign = (profileId: string, shift: (typeof shifts)[number]): boolean => {
    const profile = candidates.find((candidate) => candidate.id === profileId);
    if (profile === undefined) return false;
    const existing = selected.get(profileId) ?? [];
    if (profile.unavailability.some((item) => overlaps(item.startsAt, item.endsAt, shift.startsAt, shift.endsAt))) return false;
    const historicalShifts = profile.assignments.map((assignment) => assignment.shift);
    if ([...historicalShifts, ...existing].some((item) => overlaps(item.startsAt, item.endsAt, shift.startsAt, shift.endsAt))) return false;
    const proposed = [...existing, shift];
    const rest = restAroundShift(
      [...profile.assignments, ...existing.map((item) => ({ shift: item, status: "DRAFT" }))],
      shift.startsAt,
      shift.endsAt,
    );
    if ((rest.restBeforeMinutes !== null && rest.restBeforeMinutes < profile.minRestMinutes) ||
        (rest.restAfterMinutes !== null && rest.restAfterMinutes < profile.minRestMinutes)) return false;
    const historicalWeeklyMinutes = profile.assignments
      .filter((assignment) => assignment.shift.rosterWeekStart.getTime() === weekStart.getTime())
      .reduce((total, assignment) => total + durationMinutes(assignment.shift.startsAt, assignment.shift.endsAt), 0);
    const minutes = historicalWeeklyMinutes + proposed.reduce((total, item) => total + durationMinutes(item.startsAt, item.endsAt), 0);
    if (minutes > profile.maxMinutesPerWeek) return false;
    const allShifts = [...historicalShifts, ...proposed];
    if (consecutiveDayRunContaining(allShifts, proposed) > profile.maxConsecutiveShifts) return false;
    const proposedNights = proposed.filter((item) => item.shiftType === "NIGHT");
    if (proposedNights.length > 0 && consecutiveDayRunContaining(
      allShifts.filter((item) => item.shiftType === "NIGHT"),
      proposedNights,
    ) > profile.maxConsecutiveNightShifts) return false;
    return true;
  };

  const solve = (shiftIndex: number): boolean => {
    if (shiftIndex === shifts.length) return true;
    const shift = shifts[shiftIndex];
    const rankedCandidates = candidates
      .filter((candidate) => canAssign(candidate.id, shift))
      .sort((left, right) => {
        const leftSelected = selected.get(left.id) ?? [];
        const rightSelected = selected.get(right.id) ?? [];
        const weeklyMinutes = (candidate: (typeof candidates)[number], proposed: typeof shifts): number =>
          candidate.assignments
            .filter((assignment) => assignment.shift.rosterWeekStart.getTime() === weekStart.getTime())
            .reduce((total, assignment) => total + durationMinutes(assignment.shift.startsAt, assignment.shift.endsAt), 0) +
          proposed.reduce((total, item) => total + durationMinutes(item.startsAt, item.endsAt), 0);
        const leftMinutes = weeklyMinutes(left, leftSelected);
        const rightMinutes = weeklyMinutes(right, rightSelected);
        if (leftMinutes !== rightMinutes) return leftMinutes - rightMinutes;
        const leftHome = left.homeLocationId === locationId;
        const rightHome = right.homeLocationId === locationId;
        if (leftHome !== rightHome) return leftHome ? -1 : 1;
        const leftPrevious = [...left.assignments.map((assignment) => assignment.shift), ...leftSelected]
          .filter((item) => item.endsAt <= shift.startsAt)
          .sort((first, second) => second.endsAt.getTime() - first.endsAt.getTime())[0];
        const rightPrevious = [...right.assignments.map((assignment) => assignment.shift), ...rightSelected]
          .filter((item) => item.endsAt <= shift.startsAt)
          .sort((first, second) => second.endsAt.getTime() - first.endsAt.getTime())[0];
        const leftContinuity = leftPrevious?.shiftType === shift.shiftType;
        const rightContinuity = rightPrevious?.shiftType === shift.shiftType;
        if (leftContinuity !== rightContinuity) return leftContinuity ? -1 : 1;
        const leftConsecutive = consecutiveDayRunContaining(
          [...left.assignments.map((assignment) => assignment.shift), ...leftSelected, shift],
          [...leftSelected, shift],
        );
        const rightConsecutive = consecutiveDayRunContaining(
          [...right.assignments.map((assignment) => assignment.shift), ...rightSelected, shift],
          [...rightSelected, shift],
        );
        if (leftConsecutive !== rightConsecutive) return leftConsecutive - rightConsecutive;
        return left.user.employeeCode.localeCompare(right.user.employeeCode);
      });

    for (const group of combinations(rankedCandidates, shift.requiredHeadcount)) {
      for (const candidate of group) {
        selected.get(candidate.id)?.push(shift);
        assignmentsByShift.get(shift.id)?.push(candidate);
      }
      if (solve(shiftIndex + 1)) return true;
      for (const candidate of [...group].reverse()) {
        selected.get(candidate.id)?.pop();
        assignmentsByShift.get(shift.id)?.pop();
      }
    }
    return false;
  };

  if (!solve(0)) throw new Error(`Deterministic roster coverage is infeasible for ${requiredSlots} slots`);
  const proposedAssignments: ProposedRosterAssignment[] = [];
  for (const shift of shifts) {
    for (const candidate of assignmentsByShift.get(shift.id) ?? []) {
      proposedAssignments.push({
        shiftId: shift.id,
        shiftCode: shift.code,
        staffProfileId: candidate.id,
        userId: candidate.userId,
        employeeCode: candidate.user.employeeCode,
        displayName: candidate.user.displayName,
        shiftType: shift.shiftType,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        durationMinutes: durationMinutes(shift.startsAt, shift.endsAt),
        status: "DRAFT",
        source: "SCHEDULER",
      });
    }
  }
  const distribution = Object.fromEntries(
    candidates.map((candidate) => [candidate.user.employeeCode, selected.get(candidate.id)?.length ?? 0]),
  );
  return { locationId, weekStart, requiredSlots, proposedAssignments, distribution };
}

export async function getWorkforcePreparedAction(client: PrismaClient, organizationId: string, preparedActionId: string) {
  return client.preparedAction.findFirstOrThrow({
    where: { id: preparedActionId, workflowRun: { is: { organizationId } } },
    include: {
      workflowRun: true,
      approvalRequests: { include: { approvalPolicy: true, decisions: { include: { approver: true } } } },
      executions: true,
      shiftAssignments: {
        where: { shift: { organizationId }, staffProfile: { user: { is: { organizationId } } } },
        include: { shift: true, staffProfile: { include: { user: true } } },
      },
      notificationDeliveries: true,
    },
  });
}
