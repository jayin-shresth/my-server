import type { PrismaClient } from "../../generated/prisma/client.js";
import { LOCATION_IDS, ORGANIZATION_ID } from "./constants.js";
import type { CoreSeedResult, WorkforceSeedResult } from "./types.js";

const PUBLISHED_WEEK_START = new Date("2026-07-06T00:00:00+05:30");
const PLANNING_WEEK_START = new Date("2026-07-13T00:00:00+05:30");
const PROFILE_CREATED_AT = new Date("2026-06-01T09:00:00+05:30");

const publishedDates = [
  "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09",
  "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13",
] as const;

const planningDates = [
  "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16",
  "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20",
] as const;

const profileDefinitions = [
  ["user-01", "REGISTERED_NURSE", LOCATION_IDS.icu],
  ["user-02", "REGISTERED_NURSE", LOCATION_IDS.icu],
  ["user-03", "REGISTERED_NURSE", LOCATION_IDS.icu],
  ["user-04", "REGISTERED_NURSE", LOCATION_IDS.icu],
  ["user-05", "REGISTERED_NURSE", LOCATION_IDS.icu],
  ["user-06", "REGISTERED_NURSE", LOCATION_IDS.icu],
  ["user-07", "REGISTERED_NURSE", LOCATION_IDS.wardA],
  ["user-08", "REGISTERED_NURSE", LOCATION_IDS.wardB],
  ["user-09", "REGISTERED_NURSE", LOCATION_IDS.emergency],
  ["user-10", "FINANCE_ADMIN", LOCATION_IDS.central],
  ["user-11", "COMPLIANCE_OFFICER", LOCATION_IDS.pharmacy],
  ["user-12", "WORKFORCE_MANAGER", LOCATION_IDS.icu],
  ["user-13", "STORE_OFFICER", LOCATION_IDS.central],
  ["user-14", "PHARMACIST", LOCATION_IDS.pharmacy],
  ["user-15", "PROCUREMENT_OFFICER", LOCATION_IDS.central],
] as const;

const publishedAssignmentMatrix = [
  ["user-01", "user-02"],
  ["user-03", "user-04"],
  ["user-06", "user-07"],
  ["user-02", "user-05"],
  ["user-01", "user-09"],
  ["user-03", "user-04"],
  ["user-02", "user-05"],
  ["user-09", "user-06"],
  ["user-07", "user-01"],
  ["user-01", "user-02", "user-03", "user-04"],
  ["user-06", "user-09"],
  ["user-07", "user-01"],
  ["user-03", "user-04"],
  ["user-06", "user-02"],
  ["user-05", "user-07"],
  ["user-03", "user-04"],
  ["user-06", "user-09"],
  ["user-01", "user-05"],
  ["user-02", "user-03"],
  ["user-04", "user-06"],
  ["user-07", "user-09"],
] as const;

function shiftTimes(dates: readonly string[], dayIndex: number, shiftIndex: number): { shiftType: string; startsAt: Date; endsAt: Date } {
  if (shiftIndex === 0) {
    return {
      shiftType: "DAY",
      startsAt: new Date(`${dates[dayIndex]}T07:00:00+05:30`),
      endsAt: new Date(`${dates[dayIndex]}T15:00:00+05:30`),
    };
  }
  if (shiftIndex === 1) {
    return {
      shiftType: "EVENING",
      startsAt: new Date(`${dates[dayIndex]}T15:00:00+05:30`),
      endsAt: new Date(`${dates[dayIndex]}T23:00:00+05:30`),
    };
  }
  return {
    shiftType: "NIGHT",
    startsAt: new Date(`${dates[dayIndex]}T23:00:00+05:30`),
    endsAt: new Date(`${dates[dayIndex + 1]}T07:00:00+05:30`),
  };
}

async function seedProfilesAndSkills(client: PrismaClient): Promise<readonly string[]> {
  const profileIds: string[] = [];
  for (const [userId, staffType, homeLocationId] of profileDefinitions) {
    const id = `staff-${userId}`;
    profileIds.push(id);
    await client.staffProfile.upsert({
      where: { id },
      create: {
        id,
        userId,
        homeLocationId,
        staffType,
        employmentStatus: "ACTIVE",
        contractMinutesPerWeek: 2_400,
        maxMinutesPerWeek: 2_880,
        minRestMinutes: 660,
        maxConsecutiveShifts: 5,
        maxConsecutiveNightShifts: 3,
        active: true,
        createdAt: PROFILE_CREATED_AT,
        updatedAt: PROFILE_CREATED_AT,
      },
      update: {
        homeLocationId,
        staffType,
        employmentStatus: "ACTIVE",
        contractMinutesPerWeek: 2_400,
        maxMinutesPerWeek: 2_880,
        minRestMinutes: 660,
        maxConsecutiveShifts: 5,
        maxConsecutiveNightShifts: 3,
        active: true,
        updatedAt: PROFILE_CREATED_AT,
      },
    });
  }

  for (let userNumber = 1; userNumber <= 9; userNumber += 1) {
    const userId = `user-${String(userNumber).padStart(2, "0")}`;
    const staffProfileId = `staff-${userId}`;
    await client.staffSkill.upsert({
      where: { id: `skill-${userId}-basic-nursing` },
      create: {
        id: `skill-${userId}-basic-nursing`,
        staffProfileId,
        skillCode: "BASIC_NURSING",
        proficiencyLevel: "ACTIVE_PRACTICE",
        validFrom: new Date("2026-01-01T00:00:00+05:30"),
        validUntil: new Date("2026-12-31T23:59:59+05:30"),
        active: true,
      },
      update: { active: true, validUntil: new Date("2026-12-31T23:59:59+05:30") },
    });
    if (userNumber !== 8) {
      await client.staffSkill.upsert({
        where: { id: `skill-${userId}-icu-critical-care` },
        create: {
          id: `skill-${userId}-icu-critical-care`,
          staffProfileId,
          skillCode: "ICU_CRITICAL_CARE",
          proficiencyLevel: "COMPETENT",
          validFrom: new Date("2026-01-01T00:00:00+05:30"),
          validUntil: new Date("2026-12-31T23:59:59+05:30"),
          active: true,
        },
        update: { active: true, validUntil: new Date("2026-12-31T23:59:59+05:30") },
      });
    }
  }

  const nonClinicalSkills = [
    ["user-10", "FINANCE_OPERATIONS"],
    ["user-11", "COMPLIANCE_REVIEW"],
    ["user-12", "WORKFORCE_SCHEDULING"],
    ["user-13", "INVENTORY_CONTROL"],
    ["user-14", "PHARMACY_OPERATIONS"],
    ["user-15", "PROCUREMENT_OPERATIONS"],
  ] as const;
  for (const [userId, skillCode] of nonClinicalSkills) {
    await client.staffSkill.upsert({
      where: { id: `skill-${userId}-${skillCode.toLowerCase().replaceAll("_", "-")}` },
      create: {
        id: `skill-${userId}-${skillCode.toLowerCase().replaceAll("_", "-")}`,
        staffProfileId: `staff-${userId}`,
        skillCode,
        proficiencyLevel: "COMPETENT",
        validFrom: new Date("2026-01-01T00:00:00+05:30"),
        validUntil: null,
        active: true,
      },
      update: { active: true },
    });
  }
  return profileIds;
}

async function seedShiftWeek(
  client: PrismaClient,
  dates: readonly string[],
  rosterWeekStart: Date,
  status: "PUBLISHED" | "OPEN",
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    for (let shiftIndex = 0; shiftIndex < 3; shiftIndex += 1) {
      const times = shiftTimes(dates, dayIndex, shiftIndex);
      const compactDate = dates[dayIndex].replaceAll("-", "");
      const code = `SHIFT-ICU-${compactDate}-${times.shiftType}`;
      const id = `shift-icu-${compactDate.toLowerCase()}-${times.shiftType.toLowerCase()}`;
      ids.push(id);
      const requiredHeadcount = code === "SHIFT-ICU-20260709-DAY" ? 4 : 2;
      await client.shift.upsert({
        where: { id },
        create: {
          id,
          code,
          organizationId: ORGANIZATION_ID,
          locationId: LOCATION_IDS.icu,
          rosterWeekStart,
          shiftType: times.shiftType,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          requiredStaffType: "REGISTERED_NURSE",
          requiredSkillCode: "ICU_CRITICAL_CARE",
          requiredHeadcount,
          status,
          createdAt: new Date("2026-07-01T09:00:00+05:30"),
          updatedAt: new Date("2026-07-01T09:00:00+05:30"),
        },
        update: { requiredHeadcount, status, updatedAt: new Date("2026-07-01T09:00:00+05:30") },
      });
    }
  }
  return ids;
}

async function seedPublishedAssignments(client: PrismaClient, publishedShiftIds: readonly string[]): Promise<number> {
  const desiredAssignmentIds = publishedAssignmentMatrix.flatMap((userIds, shiftIndex) =>
    userIds.map((userId) => `shift-assignment-${publishedShiftIds[shiftIndex]}-${userId}`),
  );
  await client.shiftAssignment.deleteMany({
    where: {
      shiftId: { in: [...publishedShiftIds] },
      source: "SEED",
      id: { notIn: desiredAssignmentIds },
    },
  });
  let assignmentCount = 0;
  for (let shiftIndex = 0; shiftIndex < publishedAssignmentMatrix.length; shiftIndex += 1) {
    const shiftId = publishedShiftIds[shiftIndex];
    for (const userId of publishedAssignmentMatrix[shiftIndex]) {
      const isAbsent = shiftId === "shift-icu-20260709-day" && userId === "user-01";
      const id = `shift-assignment-${shiftId}-${userId}`;
      assignmentCount += 1;
      await client.shiftAssignment.upsert({
        where: { id },
        create: {
          id,
          code: `ASSIGN-${shiftId.toUpperCase()}-${userId.toUpperCase()}`,
          shiftId,
          staffProfileId: `staff-${userId}`,
          preparedActionId: null,
          status: isAbsent ? "ABSENT" : "CONFIRMED",
          source: "SEED",
          assignedAt: new Date("2026-07-05T12:00:00+05:30"),
          assignedByType: "SYSTEM",
          assignedById: "deterministic-workforce-seed",
          notes: isAbsent ? "Known absence retained for staffing-gap analysis" : "Published deterministic ICU roster",
        },
        update: {
          status: isAbsent ? "ABSENT" : "CONFIRMED",
          source: "SEED",
          notes: isAbsent ? "Known absence retained for staffing-gap analysis" : "Published deterministic ICU roster",
        },
      });
    }
  }
  return assignmentCount;
}

async function seedWorkforceWorkflowAndNotification(client: PrismaClient): Promise<readonly string[]> {
  for (const policy of [
    { id: "policy-workforce-roster-publish", code: "WORKFORCE_ROSTER_PUBLISH", actionType: "PUBLISH_ROSTER" },
    { id: "policy-workforce-shift-reassign", code: "WORKFORCE_SHIFT_REASSIGN", actionType: "REASSIGN_SHIFT" },
  ] as const) {
    await client.approvalPolicy.upsert({
      where: { id: policy.id },
      create: {
        id: policy.id,
        code: policy.code,
        actionType: policy.actionType,
        minimumAmountPaise: 0,
        maximumAmountPaise: null,
        requiredRoleCode: "OPERATIONS_ADMIN",
        requiredApprovals: 1,
        active: true,
      },
      update: { actionType: policy.actionType, requiredRoleCode: "OPERATIONS_ADMIN", requiredApprovals: 1, active: true },
    });
  }

  await client.workflowRun.upsert({
    where: { id: "workflow-workforce-gap-001" },
    create: {
      id: "workflow-workforce-gap-001",
      organizationId: ORGANIZATION_ID,
      code: "WF-WORKFORCE-GAP-001",
      workflowType: "WORKFORCE_GAP",
      status: "WAITING_APPROVAL",
      startedAt: new Date("2026-07-09T07:15:00+05:30"),
      completedAt: null,
      correlationId: "corr-workforce-gap-20260709-day",
    },
    update: { status: "WAITING_APPROVAL", completedAt: null },
  });
  await client.preparedAction.upsert({
    where: { id: "action-workforce-reassign-001" },
    create: {
      id: "action-workforce-reassign-001",
      code: "PA-WORKFORCE-REASSIGN-001",
      workflowRunId: "workflow-workforce-gap-001",
      actionType: "REASSIGN_SHIFT",
      requesterType: "AGENT",
      requesterId: "future-workforce-coordinator",
      status: "PENDING_APPROVAL",
      amountPaise: null,
      targetType: "SHIFT",
      targetId: "shift-icu-20260709-day",
      payloadJson: JSON.stringify({ replacementStaffProfileId: "staff-user-05", preserveAbsentAssignment: true }),
      evidenceJson: JSON.stringify({ activeCoverage: 3, requiredHeadcount: 4, deterministicCandidateRank: 1 }),
      reasoningSummary: "User 05 is the only eligible deterministic replacement; execution remains approval-gated.",
      preparedAt: new Date("2026-07-09T07:20:00+05:30"),
    },
    update: {
      status: "PENDING_APPROVAL",
      payloadJson: JSON.stringify({ replacementStaffProfileId: "staff-user-05", preserveAbsentAssignment: true }),
      evidenceJson: JSON.stringify({ activeCoverage: 3, requiredHeadcount: 4, deterministicCandidateRank: 1 }),
    },
  });
  await client.approvalRequest.upsert({
    where: { id: "approval-action-workforce-reassign-001" },
    create: {
      id: "approval-action-workforce-reassign-001",
      code: "AR-WORKFORCE-REASSIGN-001",
      preparedActionId: "action-workforce-reassign-001",
      approvalPolicyId: "policy-workforce-shift-reassign",
      status: "PENDING",
      requestedAt: new Date("2026-07-09T07:22:00+05:30"),
      resolvedAt: null,
    },
    update: { status: "PENDING", resolvedAt: null },
  });

  const notificationId = "notification-workforce-gap-approval-001";
  await client.notificationDelivery.upsert({
    where: { id: notificationId },
    create: {
      id: notificationId,
      code: "NOTIFY-WORKFORCE-GAP-001",
      preparedActionId: "action-workforce-reassign-001",
      idempotencyKey: "gmail:action-workforce-reassign-001:approval-request",
      channel: "GMAIL",
      purpose: "WORKFORCE_APPROVAL_REQUEST",
      recipientMasked: "w***@careflow.example.invalid",
      recipientHash: "7e6f295043508127e70878d599e69d018fd8d3f0a244cf470d9f35ed283f27b1",
      status: "PENDING",
      providerMessageId: null,
      attemptCount: 0,
      requestedAt: new Date("2026-07-09T07:23:00+05:30"),
      sentAt: null,
      failedAt: null,
      lastError: null,
    },
    update: { status: "PENDING", providerMessageId: null, attemptCount: 0, sentAt: null, failedAt: null, lastError: null },
  });

  const auditInputs = [
    [26, "SHIFT_ABSENCE_RECORDED", "SHIFT_ASSIGNMENT", "shift-assignment-shift-icu-20260709-day-user-01"],
    [27, "WORKFORCE_GAP_DETECTED", "SHIFT", "shift-icu-20260709-day"],
    [28, "ACTION_PREPARED", "PREPARED_ACTION", "action-workforce-reassign-001"],
    [29, "APPROVAL_REQUESTED", "APPROVAL_REQUEST", "approval-action-workforce-reassign-001"],
    [30, "NOTIFICATION_REQUESTED", "NOTIFICATION_DELIVERY", notificationId],
  ] as const;
  for (const [sequence, eventType, subjectType, subjectId] of auditInputs) {
    await client.auditEvent.upsert({
      where: { id: `audit-${String(sequence).padStart(3, "0")}` },
      create: {
        id: `audit-${String(sequence).padStart(3, "0")}`,
        organizationId: ORGANIZATION_ID,
        sequence,
        eventType,
        actorType: sequence === 26 ? "SYSTEM" : "AGENT",
        actorId: sequence === 26 ? "deterministic-workforce-seed" : "future-workforce-coordinator",
        subjectType,
        subjectId,
        occurredAt: new Date(`2026-07-09T07:${String(sequence - 10).padStart(2, "0")}:00+05:30`),
        detailsJson: JSON.stringify({ deterministic: true, workforce: true }),
      },
      update: { eventType, subjectType, subjectId, detailsJson: JSON.stringify({ deterministic: true, workforce: true }) },
    });
  }
  return [notificationId];
}

export async function seedWorkforce(client: PrismaClient, _core: CoreSeedResult): Promise<WorkforceSeedResult> {
  const staffProfileIds = await seedProfilesAndSkills(client);
  const publishedShiftIds = await seedShiftWeek(client, publishedDates, PUBLISHED_WEEK_START, "PUBLISHED");
  const planningShiftIds = await seedShiftWeek(client, planningDates, PLANNING_WEEK_START, "OPEN");
  const assignmentCount = await seedPublishedAssignments(client, publishedShiftIds);
  await client.staffUnavailability.upsert({
    where: { id: "unavailability-user-07-target-shift" },
    create: {
      id: "unavailability-user-07-target-shift",
      code: "UNAVAIL-USER-07-20260709",
      staffProfileId: "staff-user-07",
      approvedByUserId: "user-12",
      unavailabilityType: "APPROVED_LEAVE",
      status: "APPROVED",
      startsAt: new Date("2026-07-09T06:00:00+05:30"),
      endsAt: new Date("2026-07-09T16:00:00+05:30"),
      reason: "Approved synthetic personal leave",
      recordedAt: new Date("2026-07-02T10:00:00+05:30"),
    },
    update: { approvedByUserId: "user-12", status: "APPROVED" },
  });
  const notificationDeliveryIds = await seedWorkforceWorkflowAndNotification(client);
  return { staffProfileIds, publishedShiftIds, planningShiftIds, assignmentCount, notificationDeliveryIds };
}
