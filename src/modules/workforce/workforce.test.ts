import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { ReplacementCandidateResult, ReplacementExclusionCode } from '../../data/workforce.js';
import {
  WorkforcePolicyEvaluator,
  intervalsOverlap,
  longestConsecutiveNightRun,
  longestConsecutiveShiftRun,
  restMinutesBetween,
  type CandidatePolicySnapshot,
} from './workforce.policy.js';
import { WorkforceRosterPlanner } from './workforce.planner.js';
import { WorkforceRepository } from './workforce.repository.js';
import { WorkforceService } from './workforce.service.js';
import { WorkforceError, parseRosterWeekStart, publicRationaleSchema, weekStartSchema, type WorkforceIdentity } from './workforce.types.js';

const sourceDatabase = resolve('database/careflow.db');
const identity: WorkforceIdentity = {
  subject: 'user-12',
  organizationId: 'org-careflow-001',
  actorType: 'USER',
  executionRequestId: 'test-request',
};

let directory: string;
let client: PrismaClient;
let repository: WorkforceRepository;
let service: WorkforceService;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'careflow-workforce-'));
  const database = join(directory, 'careflow-test.db');
  copyFileSync(sourceDatabase, database);
  const adapter = new PrismaBetterSqlite3({ url: `file:${database.replaceAll('\\', '/')}` });
  client = new PrismaClient({ adapter });
  repository = new WorkforceRepository(client);
  service = new WorkforceService(repository, new WorkforcePolicyEvaluator(), new WorkforceRosterPlanner());
});

afterEach(async () => {
  await client.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

function candidate(overrides: Partial<ReplacementCandidateResult> & { exclusionReasonCodes?: readonly ReplacementExclusionCode[] } = {}): CandidatePolicySnapshot {
  return {
    candidate: {
      staffProfileId: overrides.staffProfileId ?? 'staff-synthetic',
      userId: overrides.userId ?? 'user-synthetic',
      employeeCode: overrides.employeeCode ?? 'EMP-SYNTHETIC',
      displayName: overrides.displayName ?? 'Synthetic Worker',
      eligible: overrides.eligible ?? true,
      exclusionReasonCodes: overrides.exclusionReasonCodes ?? [],
      scheduledMinutes: overrides.scheduledMinutes ?? 1_920,
      resultingMinutes: overrides.resultingMinutes ?? 2_400,
      restBeforeMinutes: overrides.restBeforeMinutes ?? 660,
      restAfterMinutes: overrides.restAfterMinutes ?? null,
      skillValidThroughShiftEnd: overrides.skillValidThroughShiftEnd ?? true,
      homeLocationMatch: overrides.homeLocationMatch ?? true,
      recentShiftTypeContinuity: overrides.recentShiftTypeContinuity ?? false,
      consecutiveShiftCount: overrides.consecutiveShiftCount ?? 5,
      consecutiveNightCount: overrides.consecutiveNightCount ?? 3,
      deterministicRank: overrides.deterministicRank ?? 1,
      recommended: overrides.recommended ?? false,
    },
    activeEmployment: true,
    maxMinutesPerWeek: 2_880,
    minRestMinutes: 660,
    maxConsecutiveShifts: 5,
    maxConsecutiveNightShifts: 3,
  };
}

describe('CareFlow workforce demo contract', () => {
  test('returns exact published-week coverage and candidate outcomes', async () => {
    const coverage = await service.getShiftCoverage('shift-icu-20260709-day', identity);
    assert.equal(coverage.shiftCode, 'SHIFT-ICU-20260709-DAY');
    assert.equal(coverage.requiredHeadcount, 4);
    assert.equal(coverage.confirmedCoverage, 3);
    assert.equal(coverage.absentCoverage, 1);
    assert.equal(coverage.gapSize, 1);

    const result = await service.evaluateReplacementCandidates('shift-icu-20260709-day', identity);
    const byUser = (userId: string) => result.candidates.find((item) => item.userId === userId);
    assert.equal(result.recommendedCandidate?.userId, 'user-05');
    assert.equal(byUser('user-05')?.eligible, true);
    assert.equal(byUser('user-05')?.currentWeeklyMinutes, 1_920);
    assert.equal(byUser('user-05')?.resultingWeeklyMinutes, 2_400);
    assert.ok(byUser('user-06')?.reasonCodes.includes('MAX_WEEKLY_MINUTES'));
    assert.ok(byUser('user-07')?.reasonCodes.includes('APPROVED_UNAVAILABILITY'));
    assert.ok(byUser('user-08')?.reasonCodes.includes('MISSING_REQUIRED_SKILL'));
    assert.ok(byUser('user-09')?.reasonCodes.includes('MINIMUM_REST'));
  });

  test('analysis and planning tools do not write assignments', async () => {
    const before = await client.shiftAssignment.count();
    await service.analyzeStaffingGap('shift-icu-20260709-day', identity);
    const firstPlan = await service.buildWeeklyRosterPlan('loc-04', '2026-07-13', identity);
    const secondPlan = await service.buildWeeklyRosterPlan('loc-04', '2026-07-13', identity);
    assert.equal(await client.shiftAssignment.count(), before);
    assert.equal(firstPlan.proposedAssignments.length, 42);
    assert.equal(firstPlan.planHash, secondPlan.planHash);
    assert.equal(firstPlan.uncoveredSlots.length, 0);
    assert.deepEqual(firstPlan.workloadDistribution.map((item) => item.resultingHours).sort((a, b) => b - a), [48, 48, 40, 40, 40, 40, 40, 40]);
  });

  test('weekly workload includes assignments from every organization location', async () => {
    const before = await service.getStaffWeeklyWorkload('staff-user-05', '2026-07-06', identity);
    await client.shift.create({
      data: {
        id: 'shift-cross-location-workload',
        code: 'SHIFT-CROSS-LOCATION-WORKLOAD',
        organizationId: identity.organizationId,
        locationId: 'loc-05',
        rosterWeekStart: parseRosterWeekStart('2026-07-06'),
        shiftType: 'DAY',
        startsAt: new Date('2026-07-12T10:30:00.000Z'),
        endsAt: new Date('2026-07-12T11:30:00.000Z'),
        requiredStaffType: 'NURSE',
        requiredSkillCode: 'GENERAL_NURSING',
        requiredHeadcount: 1,
        status: 'PUBLISHED',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    await client.shiftAssignment.create({
      data: {
        id: 'assignment-cross-location-workload',
        code: 'ASSIGN-CROSS-LOCATION-WORKLOAD',
        shiftId: 'shift-cross-location-workload',
        staffProfileId: 'staff-user-05',
        status: 'CONFIRMED',
        source: 'TEST',
        assignedAt: new Date('2026-07-01T00:00:00.000Z'),
        assignedByType: 'SYSTEM',
        notes: 'Verifies organization-wide weekly workload aggregation.',
      },
    });

    const after = await service.getStaffWeeklyWorkload('staff-user-05', '2026-07-06', identity);
    assert.equal(after.assignedMinutes, before.assignedMinutes + 60);
    assert.ok(after.assignments.some((assignment) => assignment.locationId === 'loc-05'));
  });
});

describe('workforce weekStart validation', () => {
  test('accepts real Monday boundaries in Asia/Kolkata', () => {
    assert.equal(weekStartSchema.safeParse('2026-07-06').success, true);
    assert.equal(weekStartSchema.safeParse('2026-07-13').success, true);
  });

  test('rejects normalized invalid dates, non-Mondays, and malformed values', () => {
    for (const value of ['2026-02-30', '2026-07-07', '2026-7-06']) {
      assert.equal(weekStartSchema.safeParse(value).success, false, `${value} must be rejected`);
      assert.throws(() => parseRosterWeekStart(value), (error: unknown) => (
        error instanceof WorkforceError && error.code === 'INVALID_WEEK_START'
      ));
    }
  });
});

describe('deterministic workforce policy boundaries', () => {
  test('uses half-open overlap boundaries', () => {
    const start = new Date('2026-07-09T07:00:00+05:30');
    const end = new Date('2026-07-09T15:00:00+05:30');
    assert.equal(intervalsOverlap(new Date('2026-07-08T23:00:00+05:30'), start, start, end), false);
    assert.equal(intervalsOverlap(new Date('2026-07-09T06:59:00+05:30'), new Date('2026-07-09T07:01:00+05:30'), start, end), true);
  });

  test('accepts exact 11-hour rest and exact 48-hour workload boundaries', () => {
    assert.equal(restMinutesBetween(new Date('2026-07-08T20:00:00+05:30'), new Date('2026-07-09T07:00:00+05:30')), 660);
    const result = new WorkforcePolicyEvaluator().evaluateCandidates([candidate({ resultingMinutes: 2_880, restBeforeMinutes: 660 })]);
    assert.equal(result[0].eligible, true);
  });

  test('accepts five consecutive shifts and three nights, then rejects the next one', () => {
    const shifts = Array.from({ length: 6 }, (_, index) => ({
      shiftType: 'DAY',
      startsAt: new Date(`2026-07-${String(6 + index).padStart(2, '0')}T07:00:00+05:30`),
      endsAt: new Date(`2026-07-${String(6 + index).padStart(2, '0')}T15:00:00+05:30`),
    }));
    assert.equal(longestConsecutiveShiftRun(shifts.slice(0, 5)), 5);
    assert.equal(longestConsecutiveShiftRun(shifts), 6);
    const nights = shifts.slice(0, 4).map((shift) => ({ ...shift, shiftType: 'NIGHT' }));
    assert.equal(longestConsecutiveNightRun(nights.slice(0, 3)), 3);
    assert.equal(longestConsecutiveNightRun(nights), 4);
  });

  test('emits every public hard-rule rejection code', () => {
    const snapshots = [
      { ...candidate({ employeeCode: 'E01', exclusionReasonCodes: ['INACTIVE_PROFILE'] }), activeEmployment: false },
      candidate({ employeeCode: 'E02', exclusionReasonCodes: ['MISSING_REQUIRED_SKILL'] }),
      candidate({ employeeCode: 'E03', exclusionReasonCodes: ['APPROVED_UNAVAILABILITY'] }),
      candidate({ employeeCode: 'E04', exclusionReasonCodes: ['SHIFT_OVERLAP'] }),
      candidate({ employeeCode: 'E05', exclusionReasonCodes: ['MAX_WEEKLY_MINUTES'], resultingMinutes: 2_881 }),
      candidate({ employeeCode: 'E06', exclusionReasonCodes: ['MINIMUM_REST'], restBeforeMinutes: 659 }),
      candidate({ employeeCode: 'E07', exclusionReasonCodes: ['MAX_CONSECUTIVE_SHIFTS'], consecutiveShiftCount: 6 }),
      candidate({ employeeCode: 'E08', exclusionReasonCodes: ['MAX_CONSECUTIVE_NIGHTS'], consecutiveNightCount: 4 }),
    ];
    const codes = new Set(new WorkforcePolicyEvaluator().evaluateCandidates(snapshots).flatMap((item) => item.reasonCodes));
    for (const code of [
      'INACTIVE_EMPLOYMENT', 'MISSING_REQUIRED_SKILL', 'APPROVED_UNAVAILABILITY', 'SHIFT_OVERLAP',
      'MAX_WEEKLY_MINUTES', 'MINIMUM_REST', 'MAX_CONSECUTIVE_SHIFTS', 'MAX_CONSECUTIVE_NIGHTS',
    ]) assert.ok(codes.has(code as never), `missing ${code}`);
  });

  test('ranks eligible candidates lexicographically and reproducibly', () => {
    const evaluator = new WorkforcePolicyEvaluator();
    const snapshots = [
      candidate({ staffProfileId: 'staff-b', employeeCode: 'EMP-002', homeLocationMatch: false, scheduledMinutes: 1_920 }),
      candidate({ staffProfileId: 'staff-a', employeeCode: 'EMP-001', homeLocationMatch: true, scheduledMinutes: 1_920 }),
      candidate({ staffProfileId: 'staff-c', employeeCode: 'EMP-003', scheduledMinutes: 2_400 }),
    ];
    assert.deepEqual(evaluator.evaluateCandidates(snapshots).map((item) => item.staffId), ['staff-a', 'staff-b', 'staff-c']);
    assert.deepEqual(evaluator.evaluateCandidates(snapshots).map((item) => item.finalRank), [1, 2, 3]);
  });
});

describe('approval-gated workforce preparation', () => {
  test('prepares reassignment using only draft workflow/action/audit records', async () => {
    const before = {
      workflows: await client.workflowRun.count(),
      actions: await client.preparedAction.count(),
      audits: await client.auditEvent.count(),
      approvals: await client.approvalRequest.count(),
      assignments: await client.shiftAssignment.count(),
      notifications: await client.notificationDelivery.count(),
    };
    const action = await service.prepareStaffReassignment({
      shiftId: 'shift-icu-20260709-day',
      candidateStaffId: 'staff-user-05',
      idempotencyKey: 'test-reassign-001',
      rationaleSummary: 'Prepare the eligible replacement for governance review.',
    }, identity);
    assert.equal(action.status, 'DRAFT');
    assert.equal(action.actionType, 'REASSIGN_SHIFT');
    assert.equal(action.approvalState, 'NOT_REQUESTED');
    assert.equal(await client.workflowRun.count(), before.workflows + 1);
    assert.equal(await client.preparedAction.count(), before.actions + 1);
    assert.equal(await client.auditEvent.count(), before.audits + 1);
    assert.equal(await client.approvalRequest.count(), before.approvals);
    assert.equal(await client.shiftAssignment.count(), before.assignments);
    assert.equal(await client.notificationDelivery.count(), before.notifications);
  });

  test('replays an identical key and rejects conflicting content', async () => {
    const request = {
      shiftId: 'shift-icu-20260709-day',
      candidateStaffId: 'staff-user-05',
      idempotencyKey: 'test-reassign-replay',
      rationaleSummary: 'Prepare the eligible replacement for governance review.',
    };
    const first = await service.prepareStaffReassignment(request, identity);
    const second = await service.prepareStaffReassignment(request, identity);
    assert.equal(first.preparedActionId, second.preparedActionId);
    await assert.rejects(
      service.prepareStaffReassignment({ ...request, rationaleSummary: 'Prepare a materially different workforce rationale.' }, identity),
      (error: unknown) => error instanceof WorkforceError && error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  test('prepares a weekly roster without ShiftAssignment writes and rejects a stale hash', async () => {
    const assignmentsBefore = await client.shiftAssignment.count();
    const plan = await service.buildWeeklyRosterPlan('loc-04', '2026-07-13', identity);
    const action = await service.prepareWeeklyRoster({
      locationId: 'loc-04',
      weekStart: '2026-07-13',
      expectedPlanHash: plan.planHash,
      idempotencyKey: 'test-roster-001',
      rationaleSummary: 'Prepare the deterministic ICU roster for governance review.',
    }, identity);
    assert.equal(action.actionType, 'PUBLISH_ROSTER');
    assert.equal(action.status, 'DRAFT');
    assert.equal(await client.shiftAssignment.count(), assignmentsBefore);
    await assert.rejects(
      service.prepareWeeklyRoster({
        locationId: 'loc-04',
        weekStart: '2026-07-13',
        expectedPlanHash: `wfplan_${'0'.repeat(64)}`,
        idempotencyKey: 'test-roster-stale',
        rationaleSummary: 'Prepare the deterministic ICU roster for governance review.',
      }, identity),
      (error: unknown) => error instanceof WorkforceError && error.code === 'STALE_PLAN',
    );
  });

  test('rejects cross-organization reads and unsupported or sensitive rationale', async () => {
    await assert.rejects(
      service.getShiftCoverage('shift-icu-20260709-day', { ...identity, organizationId: 'org-outside' }),
      (error: unknown) => error instanceof WorkforceError && error.code === 'SHIFT_NOT_FOUND',
    );
    assert.equal(publicRationaleSchema.safeParse('Forecast staffing demand for patient treatment.').success, false);
    assert.equal(publicRationaleSchema.safeParse('Contact nurse@example.org using api_token abc.').success, false);
  });
});

test('widget manifest has one deterministic workforce preview after shared integration', () => {
  const manifest = JSON.parse(readFileSync(resolve('src/widgets/widget-manifest.json'), 'utf8')) as { widgets: Array<{ uri: string; examples?: unknown[] }> };
  const entries = manifest.widgets.filter((widget) => widget.uri === '/workforce-coordinator');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].examples?.length, 1);
});
