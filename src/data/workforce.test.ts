import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";
import {
  buildWeeklyRosterPlan,
  evaluateReplacementCandidates,
  getShiftCoverage,
  getStaffWeeklyWorkload,
  getWeeklyRoster,
  getWorkforcePreparedAction,
} from "./workforce.js";

const ORGANIZATION_ID = "org-careflow-001";
const SECOND_ORGANIZATION_ID = "org-careflow-002";
const TARGET_SHIFT_ID = "shift-icu-20260709-day";
const WEEK_START = new Date("2026-07-05T18:30:00.000Z");

let directory: string;
let client: PrismaClient;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "careflow-data-workforce-"));
  const database = join(directory, "careflow-test.db");
  copyFileSync(resolve("data/careflow.db"), database);
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${database.replaceAll("\\", "/")}` }) });
});

afterEach(async () => {
  await client.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

async function createSyntheticStaff(id: string, maxMinutesPerWeek = 10_000) {
  await client.user.create({
    data: { id: `user-${id}`, organizationId: ORGANIZATION_ID, employeeCode: `EMP-${id}`, displayName: `Test ${id}`, email: `${id}@example.invalid` },
  });
  await client.staffProfile.create({
    data: {
      id: `staff-${id}`, userId: `user-${id}`, homeLocationId: "loc-04", staffType: "REGISTERED_NURSE",
      employmentStatus: "ACTIVE", contractMinutesPerWeek: 2_400, maxMinutesPerWeek, minRestMinutes: 660,
      maxConsecutiveShifts: 5, maxConsecutiveNightShifts: 3, createdAt: new Date(), updatedAt: new Date(),
    },
  });
  await client.staffSkill.create({
    data: { id: `skill-${id}`, staffProfileId: `staff-${id}`, skillCode: "ICU_CRITICAL_CARE", proficiencyLevel: "ADVANCED", validFrom: new Date("2020-01-01") },
  });
  return `staff-${id}`;
}

async function assignShift(
  staffProfileId: string,
  suffix: string,
  startsAt: Date,
  endsAt: Date,
  locationId = "loc-03",
  rosterWeekStart = WEEK_START,
) {
  const shiftId = `test-shift-${suffix}`;
  await client.shift.create({
    data: {
      id: shiftId, code: `TEST-SHIFT-${suffix}`, organizationId: ORGANIZATION_ID, locationId, rosterWeekStart,
      shiftType: "DAY", startsAt, endsAt, requiredStaffType: "REGISTERED_NURSE", requiredSkillCode: "ICU_CRITICAL_CARE",
      requiredHeadcount: 1, status: "PUBLISHED", createdAt: new Date(), updatedAt: new Date(),
    },
  });
  await client.shiftAssignment.create({
    data: {
      id: `test-assignment-${suffix}`, code: `TEST-ASSIGNMENT-${suffix}`, shiftId, staffProfileId, status: "CONFIRMED",
      source: "MANUAL", assignedAt: new Date(), assignedByType: "SYSTEM", notes: "Temporary integration fixture",
    },
  });
}

async function createSecondOrganizationFixture() {
  const createdAt = new Date("2026-07-01T00:00:00.000Z");
  await client.organization.create({
    data: {
      id: SECOND_ORGANIZATION_ID, code: "CAREFLOW-SECOND", name: "CareFlow Second", legalName: "CareFlow Second Test",
      timezone: "Asia/Kolkata", currency: "INR", createdAt,
    },
  });
  await client.location.create({
    data: {
      id: "loc-second", organizationId: SECOND_ORGANIZATION_ID, code: "SECOND-ICU", name: "Second ICU", locationType: "ICU",
      addressLine: "Test address", city: "Pune", state: "Maharashtra", postalCode: "411001", createdAt,
    },
  });
  await client.user.create({
    data: {
      id: "user-second", organizationId: SECOND_ORGANIZATION_ID, employeeCode: "EMP-SECOND", displayName: "Second Nurse",
      email: "second-nurse@example.invalid",
    },
  });
  await client.staffProfile.create({
    data: {
      id: "staff-second", userId: "user-second", homeLocationId: "loc-second", staffType: "REGISTERED_NURSE",
      employmentStatus: "ACTIVE", contractMinutesPerWeek: 2_400, maxMinutesPerWeek: 2_880, minRestMinutes: 660,
      maxConsecutiveShifts: 5, maxConsecutiveNightShifts: 3, createdAt, updatedAt: createdAt,
    },
  });
  await client.shift.create({
    data: {
      id: "shift-second", code: "SHIFT-SECOND", organizationId: SECOND_ORGANIZATION_ID, locationId: "loc-second",
      rosterWeekStart: WEEK_START, shiftType: "DAY", startsAt: new Date("2026-07-06T01:30:00.000Z"),
      endsAt: new Date("2026-07-06T09:30:00.000Z"), requiredStaffType: "REGISTERED_NURSE",
      requiredSkillCode: "ICU_CRITICAL_CARE", requiredHeadcount: 1, status: "PUBLISHED", createdAt, updatedAt: createdAt,
    },
  });
  await client.workflowRun.create({
    data: {
      id: "workflow-second", organizationId: SECOND_ORGANIZATION_ID, code: "WORKFLOW-SECOND", workflowType: "WORKFORCE_GAP",
      status: "PREPARED", startedAt: createdAt, correlationId: "workflow-second-correlation",
    },
  });
  await client.preparedAction.create({
    data: {
      id: "action-second", code: "ACTION-SECOND", workflowRunId: "workflow-second", actionType: "REASSIGN_SHIFT",
      requesterType: "SYSTEM", status: "DRAFT", targetType: "SHIFT", targetId: "shift-second", payloadJson: "{}",
      evidenceJson: "{}", reasoningSummary: "Second organization isolation fixture", preparedAt: createdAt,
    },
  });
}

describe("organization-scoped workforce data queries", () => {
  test("treats real cross-organization identifiers as not found", async () => {
    await createSecondOrganizationFixture();
    await assert.rejects(getShiftCoverage(client, ORGANIZATION_ID, "shift-second"));
    await assert.rejects(getWeeklyRoster(client, ORGANIZATION_ID, "loc-second", WEEK_START));
    await assert.rejects(getStaffWeeklyWorkload(client, ORGANIZATION_ID, "staff-second", WEEK_START));
    await assert.rejects(getWorkforcePreparedAction(client, ORGANIZATION_ID, "action-second"));
    await assert.rejects(getShiftCoverage(client, SECOND_ORGANIZATION_ID, TARGET_SHIFT_ID));
  });

  test("preserves the exact demo and deterministic read-only planner outcomes", async () => {
    const before = await client.shiftAssignment.count();
    const coverage = await getShiftCoverage(client, ORGANIZATION_ID, TARGET_SHIFT_ID);
    assert.deepEqual([coverage.activeAssignmentCount, coverage.requiredHeadcount, coverage.openPositions], [3, 4, 1]);
    const candidates = await evaluateReplacementCandidates(client, ORGANIZATION_ID, TARGET_SHIFT_ID);
    const byUser = (id: string) => candidates.find((candidate) => candidate.userId === id);
    assert.equal(byUser("user-05")?.recommended, true);
    assert.deepEqual([byUser("user-05")?.scheduledMinutes, byUser("user-05")?.resultingMinutes], [1_920, 2_400]);
    assert.ok(byUser("user-06")?.exclusionReasonCodes.includes("MAX_WEEKLY_MINUTES"));
    assert.ok(byUser("user-07")?.exclusionReasonCodes.includes("APPROVED_UNAVAILABILITY"));
    assert.ok(byUser("user-08")?.exclusionReasonCodes.includes("MISSING_REQUIRED_SKILL"));
    assert.ok(byUser("user-09")?.exclusionReasonCodes.includes("MINIMUM_REST"));
    const planningWeek = new Date("2026-07-12T18:30:00.000Z");
    const first = await buildWeeklyRosterPlan(client, ORGANIZATION_ID, "loc-04", planningWeek);
    const second = await buildWeeklyRosterPlan(client, ORGANIZATION_ID, "loc-04", planningWeek);
    assert.deepEqual(first, second);
    assert.equal(first.proposedAssignments.length, 42);
    assert.deepEqual(Object.values(first.distribution).sort((a, b) => b - a), [6, 6, 5, 5, 5, 5, 5, 5]);
    assert.equal(await client.shiftAssignment.count(), before);
  });

  test("redistributes planning work around an active assignment at another location", async () => {
    const planningWeek = new Date("2026-07-12T18:30:00.000Z");
    const outsideStart = new Date("2026-07-13T01:30:00.000Z");
    await assignShift(
      "staff-user-01",
      "PLANNING-OUTSIDE",
      outsideStart,
      new Date(outsideStart.getTime() + 480 * 60_000),
      "loc-03",
      planningWeek,
    );
    const before = await client.shiftAssignment.count();
    const first = await buildWeeklyRosterPlan(client, ORGANIZATION_ID, "loc-04", planningWeek);
    const second = await buildWeeklyRosterPlan(client, ORGANIZATION_ID, "loc-04", planningWeek);
    assert.deepEqual(first, second);
    assert.equal(first.proposedAssignments.length, 42);
    const requiredByShift = new Map((await client.shift.findMany({
      where: { organizationId: ORGANIZATION_ID, locationId: "loc-04", rosterWeekStart: planningWeek },
      select: { id: true, requiredHeadcount: true },
    })).map((shift) => [shift.id, shift.requiredHeadcount]));
    for (const [shiftId, required] of requiredByShift) {
      assert.equal(first.proposedAssignments.filter((assignment) => assignment.shiftId === shiftId).length, required);
    }
    const profiles = [...new Set(first.proposedAssignments.map((assignment) => assignment.staffProfileId))];
    const resultingMinutes = new Map<string, number>();
    for (const profileId of profiles) {
      const baseline = await getStaffWeeklyWorkload(client, ORGANIZATION_ID, profileId, planningWeek);
      const proposed = first.proposedAssignments
        .filter((assignment) => assignment.staffProfileId === profileId)
        .reduce((total, assignment) => total + assignment.durationMinutes, 0);
      resultingMinutes.set(profileId, baseline.scheduledMinutes + proposed);
    }
    assert.equal((await getStaffWeeklyWorkload(client, ORGANIZATION_ID, "staff-user-01", planningWeek)).scheduledMinutes, 480);
    const outsideWorker = await client.user.findUniqueOrThrow({ where: { id: "user-01" }, select: { employeeCode: true } });
    assert.equal(first.distribution[outsideWorker.employeeCode], 5);
    assert.ok([...resultingMinutes.values()].every((minutes) => minutes <= 2_880));
    assert.equal(await client.shiftAssignment.count(), before);
  });

  test("counts active work at every location and enforces the exact 48-hour boundary", async () => {
    const staffId = await createSyntheticStaff("BOUNDARY", 2_880);
    const starts = [6, 7, 8, 10, 11].map((day) => new Date(`2026-07-${String(day).padStart(2, "0")}T01:30:00.000Z`));
    for (const [index, start] of starts.entries()) await assignShift(staffId, `BOUNDARY-${index}`, start, new Date(start.getTime() + 480 * 60_000));
    const workload = await getStaffWeeklyWorkload(client, ORGANIZATION_ID, staffId, WEEK_START);
    assert.equal(workload.scheduledMinutes, 2_400);
    let candidate = (await evaluateReplacementCandidates(client, ORGANIZATION_ID, TARGET_SHIFT_ID)).find((item) => item.staffProfileId === staffId);
    assert.equal(candidate?.resultingMinutes, 2_880);
    assert.equal(candidate?.exclusionReasonCodes.includes("MAX_WEEKLY_MINUTES"), false);
    const extraStart = new Date("2026-07-12T17:00:00.000Z");
    await assignShift(staffId, "BOUNDARY-EXTRA", extraStart, new Date(extraStart.getTime() + 60_000));
    candidate = (await evaluateReplacementCandidates(client, ORGANIZATION_ID, TARGET_SHIFT_ID)).find((item) => item.staffProfileId === staffId);
    assert.equal(candidate?.resultingMinutes, 2_881);
    assert.ok(candidate?.exclusionReasonCodes.includes("MAX_WEEKLY_MINUTES"));
  });

  test("uses only adjacent rest and the consecutive run containing the proposed shift", async () => {
    const staffId = await createSyntheticStaff("RUNS");
    await assignShift(staffId, "OLD-REST-A", new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-01T08:00:00.000Z"));
    await assignShift(staffId, "OLD-REST-B", new Date("2026-05-01T18:00:00.000Z"), new Date("2026-05-02T02:00:00.000Z"));
    for (let day = 1; day <= 6; day += 1) {
      const start = new Date(`2026-06-${String(day).padStart(2, "0")}T01:30:00.000Z`);
      await assignShift(staffId, `OLD-${day}`, start, new Date(start.getTime() + 480 * 60_000));
    }
    let candidate = (await evaluateReplacementCandidates(client, ORGANIZATION_ID, TARGET_SHIFT_ID)).find((item) => item.staffProfileId === staffId);
    assert.equal(candidate?.exclusionReasonCodes.includes("MAX_CONSECUTIVE_SHIFTS"), false);
    assert.equal(candidate?.exclusionReasonCodes.includes("MINIMUM_REST"), false);
    for (let day = 4; day <= 8; day += 1) {
      const start = new Date(`2026-07-${String(day).padStart(2, "0")}T01:30:00.000Z`);
      await assignShift(staffId, `ADJACENT-${day}`, start, new Date(start.getTime() + 480 * 60_000));
    }
    candidate = (await evaluateReplacementCandidates(client, ORGANIZATION_ID, TARGET_SHIFT_ID)).find((item) => item.staffProfileId === staffId);
    assert.ok(candidate?.exclusionReasonCodes.includes("MAX_CONSECUTIVE_SHIFTS"));
  });

  test("accepts exactly 11 hours of adjacent rest and rejects 10 hours 59 minutes", async () => {
    const staffId = await createSyntheticStaff("REST");
    const target = await client.shift.findUniqueOrThrow({ where: { id: TARGET_SHIFT_ID } });
    const exactEnd = new Date(target.startsAt.getTime() - 660 * 60_000);
    await assignShift(staffId, "REST-BOUNDARY", new Date(exactEnd.getTime() - 480 * 60_000), exactEnd);
    let candidate = (await evaluateReplacementCandidates(client, ORGANIZATION_ID, TARGET_SHIFT_ID)).find((item) => item.staffProfileId === staffId);
    assert.equal(candidate?.restBeforeMinutes, 660);
    assert.equal(candidate?.exclusionReasonCodes.includes("MINIMUM_REST"), false);
    await client.shift.update({ where: { id: "test-shift-REST-BOUNDARY" }, data: { endsAt: new Date(exactEnd.getTime() + 60_000) } });
    candidate = (await evaluateReplacementCandidates(client, ORGANIZATION_ID, TARGET_SHIFT_ID)).find((item) => item.staffProfileId === staffId);
    assert.equal(candidate?.restBeforeMinutes, 659);
    assert.ok(candidate?.exclusionReasonCodes.includes("MINIMUM_REST"));
  });

  test("planner ignores an unrelated historical rest violation", async () => {
    await assignShift("staff-user-05", "PLANNER-OLD-A", new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-01T08:00:00.000Z"));
    await assignShift("staff-user-05", "PLANNER-OLD-B", new Date("2026-05-01T18:00:00.000Z"), new Date("2026-05-02T02:00:00.000Z"));
    const plan = await buildWeeklyRosterPlan(client, ORGANIZATION_ID, "loc-04", new Date("2026-07-12T18:30:00.000Z"));
    assert.equal(plan.proposedAssignments.length, 42);
  });
});
