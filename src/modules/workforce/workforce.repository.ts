import { createHash } from 'node:crypto';
import { Injectable } from '@nitrostack/core';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  buildWeeklyRosterPlan,
  evaluateReplacementCandidates,
  getShiftCoverage,
  getStaffWeeklyWorkload,
  getUnfilledShifts,
  getWeeklyRoster,
  getWorkforcePreparedAction,
  type WeeklyRosterPlan,
} from '../../data/workforce.js';
import type { CandidatePolicySnapshot } from './workforce.policy.js';
import { WorkforceError, type WorkforceIdentity } from './workforce.types.js';

export const WORKFORCE_PRISMA = Symbol('CAREFLOW_WORKFORCE_PRISMA');

export type WorkforceRosterRecord = Awaited<ReturnType<typeof getWeeklyRoster>>;
export type WorkforceShiftRecord = WorkforceRosterRecord[number];
export type WorkforcePreparedActionRecord = Awaited<ReturnType<typeof getWorkforcePreparedAction>>;

export type WorkloadRecord = {
  profile: Awaited<ReturnType<PrismaClient['staffProfile']['findFirstOrThrow']>> & {
    user: { id: string; employeeCode: string; displayName: string };
    homeLocation: { id: string; code: string; name: string };
    unavailability: Array<{
      id: string;
      code: string;
      unavailabilityType: string;
      startsAt: Date;
      endsAt: Date;
    }>;
  };
  workload: Awaited<ReturnType<typeof getStaffWeeklyWorkload>>;
};

export type PlanRecord = {
  plan: WeeklyRosterPlan;
  location: { id: string; code: string; name: string };
  shifts: Array<{
    id: string;
    code: string;
    requiredHeadcount: number;
    requiredSkillCode: string;
    startsAt: Date;
    endsAt: Date;
  }>;
  profiles: Array<{
    id: string;
    userId: string;
    homeLocationId: string;
    active: boolean;
    employmentStatus: string;
    maxMinutesPerWeek: number;
    minRestMinutes: number;
    maxConsecutiveShifts: number;
    maxConsecutiveNightShifts: number;
    user: { employeeCode: string; displayName: string; active: boolean };
    skills: Array<{ skillCode: string; active: boolean; validFrom: Date; validUntil: Date | null }>;
    unavailability: Array<{ status: string; startsAt: Date; endsAt: Date }>;
    assignments: Array<{
      status: string;
      shift: { id: string; shiftType: string; startsAt: Date; endsAt: Date };
    }>;
  }>;
  currentMinutes: Map<string, number>;
};

export type PreparedActionPersistence = {
  actionType: 'REASSIGN_SHIFT' | 'PUBLISH_ROSTER';
  workflowType: 'WORKFORCE_GAP' | 'WORKFORCE_ROSTER';
  targetType: 'SHIFT' | 'ROSTER_WEEK';
  targetId: string;
  idempotencyKey: string;
  rationaleSummary: string;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
};

export type PersistedDraft = {
  action: WorkforcePreparedActionRecord;
  policy: {
    id: string;
    code: string;
    requiredRoleCode: string;
    requiredApprovals: number;
  };
  auditEventId: string;
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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

function requestFingerprint(command: PreparedActionPersistence): string {
  return digest(JSON.stringify(canonicalize({
    actionType: command.actionType,
    targetType: command.targetType,
    targetId: command.targetId,
    rationaleSummary: command.rationaleSummary,
    payload: command.payload,
  })));
}

function parseEvidence(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    throw new WorkforceError('WORKFORCE_DATA_INVALID', 'Persisted workforce evidence could not be read safely.');
  }
}

@Injectable({ deps: [WORKFORCE_PRISMA] })
export class WorkforceRepository {
  constructor(private readonly client: PrismaClient) {}

  async getLocation(organizationId: string, locationId: string) {
    const location = await this.client.location.findFirst({
      where: { id: locationId, organizationId, active: true },
      select: { id: true, code: true, name: true },
    });
    if (!location) throw new WorkforceError('LOCATION_NOT_FOUND', `No active workforce location was found for ${locationId}.`);
    return location;
  }

  async getRoster(organizationId: string, locationId: string, weekStart: Date): Promise<WorkforceRosterRecord> {
    await this.getLocation(organizationId, locationId);
    const roster = await getWeeklyRoster(this.client, organizationId, locationId, weekStart);
    if (roster.some((shift) => shift.organizationId !== organizationId)) {
      throw new WorkforceError('ORGANIZATION_SCOPE_VIOLATION', 'The workforce roster returned data outside the active organization.');
    }
    return roster;
  }

  async getUnfilled(organizationId: string, locationId: string, weekStart: Date) {
    await this.getLocation(organizationId, locationId);
    const gaps = await getUnfilledShifts(this.client, organizationId, locationId, weekStart);
    const allowedShiftIds = new Set((await this.client.shift.findMany({
      where: { organizationId, locationId, rosterWeekStart: weekStart },
      select: { id: true },
    })).map((shift) => shift.id));
    if (gaps.some((gap) => !allowedShiftIds.has(gap.shiftId))) {
      throw new WorkforceError('ORGANIZATION_SCOPE_VIOLATION', 'The workforce gap query returned data outside the active organization.');
    }
    return gaps;
  }

  async getShift(organizationId: string, shiftId: string): Promise<WorkforceShiftRecord> {
    const shift = await this.client.shift.findFirst({
      where: { id: shiftId, organizationId },
      select: { locationId: true, rosterWeekStart: true },
    });
    if (!shift) throw new WorkforceError('SHIFT_NOT_FOUND', `No workforce shift was found for ${shiftId}.`);
    const roster = await this.getRoster(organizationId, shift.locationId, shift.rosterWeekStart);
    const record = roster.find((candidate) => candidate.id === shiftId);
    if (!record) throw new WorkforceError('SHIFT_NOT_FOUND', `No workforce shift was found for ${shiftId}.`);
    return record;
  }

  async getCoverage(organizationId: string, shiftId: string) {
    await this.getShift(organizationId, shiftId);
    return getShiftCoverage(this.client, organizationId, shiftId);
  }

  async getCandidateSnapshots(organizationId: string, shiftId: string): Promise<CandidatePolicySnapshot[]> {
    const shift = await this.getShift(organizationId, shiftId);
    const [evaluated, profiles] = await Promise.all([
      evaluateReplacementCandidates(this.client, organizationId, shiftId),
      this.client.staffProfile.findMany({
        where: {
          staffType: shift.requiredStaffType,
          user: { is: { organizationId } },
        },
        include: { user: { select: { active: true } } },
      }),
    ]);
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    return evaluated.flatMap((candidate) => {
      const profile = profilesById.get(candidate.staffProfileId);
      if (!profile) return [];
      return [{
        candidate,
        activeEmployment: profile.active && profile.user.active && profile.employmentStatus === 'ACTIVE',
        maxMinutesPerWeek: profile.maxMinutesPerWeek,
        minRestMinutes: profile.minRestMinutes,
        maxConsecutiveShifts: profile.maxConsecutiveShifts,
        maxConsecutiveNightShifts: profile.maxConsecutiveNightShifts,
      }];
    });
  }

  async getWorkload(organizationId: string, staffId: string, weekStart: Date): Promise<WorkloadRecord> {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const profile = await this.client.staffProfile.findFirst({
      where: { id: staffId, user: { is: { organizationId } } },
      include: {
        user: { select: { id: true, employeeCode: true, displayName: true } },
        homeLocation: { select: { id: true, code: true, name: true } },
        unavailability: {
          where: { status: 'APPROVED', startsAt: { lt: weekEnd }, endsAt: { gt: weekStart } },
          select: { id: true, code: true, unavailabilityType: true, startsAt: true, endsAt: true },
          orderBy: { startsAt: 'asc' },
        },
      },
    });
    if (!profile) throw new WorkforceError('STAFF_NOT_FOUND', `No workforce staff profile was found for ${staffId}.`);
    const workload = await getStaffWeeklyWorkload(this.client, organizationId, staffId, weekStart);
    return { profile, workload } as WorkloadRecord;
  }

  async buildPlan(organizationId: string, locationId: string, weekStart: Date): Promise<PlanRecord> {
    const location = await this.getLocation(organizationId, locationId);
    const plan = await buildWeeklyRosterPlan(this.client, organizationId, locationId, weekStart);
    const profileIds = [...new Set(plan.proposedAssignments.map((assignment) => assignment.staffProfileId))];
    const [profiles, shifts] = await Promise.all([
      this.client.staffProfile.findMany({
        where: { id: { in: profileIds }, user: { is: { organizationId } } },
        include: {
          user: { select: { employeeCode: true, displayName: true, active: true } },
          skills: { select: { skillCode: true, active: true, validFrom: true, validUntil: true } },
          unavailability: {
            where: { status: 'APPROVED' },
            select: { status: true, startsAt: true, endsAt: true },
          },
          assignments: {
            where: { status: { in: ['DRAFT', 'CONFIRMED'] } },
            include: { shift: { select: { id: true, shiftType: true, startsAt: true, endsAt: true } } },
          },
        },
      }),
      this.client.shift.findMany({
        where: { organizationId, locationId, rosterWeekStart: weekStart },
        select: { id: true, code: true, requiredHeadcount: true, requiredSkillCode: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: 'asc' },
      }),
    ]);
    if (profiles.length !== profileIds.length) {
      throw new WorkforceError('ORGANIZATION_SCOPE_VIOLATION', 'The roster planner returned staff outside the active organization.');
    }
    const workloads = await Promise.all(profiles.map((profile) => getStaffWeeklyWorkload(this.client, organizationId, profile.id, weekStart)));
    return {
      plan,
      location,
      shifts,
      profiles,
      currentMinutes: new Map(workloads.map((workload) => [workload.staffProfileId, workload.scheduledMinutes])),
    };
  }

  async getPreparedAction(organizationId: string, preparedActionId: string): Promise<WorkforcePreparedActionRecord> {
    const action = await this.client.preparedAction.findFirst({
      where: {
        id: preparedActionId,
        actionType: { in: ['REASSIGN_SHIFT', 'PUBLISH_ROSTER'] },
        workflowRun: { is: { organizationId } },
      },
      select: { id: true },
    });
    if (!action) throw new WorkforceError('PREPARED_ACTION_NOT_FOUND', `No workforce prepared action was found for ${preparedActionId}.`);
    return getWorkforcePreparedAction(this.client, organizationId, preparedActionId);
  }

  async getApprovalPolicy(actionType: string) {
    const policy = await this.client.approvalPolicy.findFirst({
      where: { actionType, active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, requiredRoleCode: true, requiredApprovals: true },
    });
    if (!policy) throw new WorkforceError('APPROVAL_POLICY_NOT_FOUND', `No active approval policy exists for ${actionType}.`);
    return policy;
  }

  async getAuditReferences(organizationId: string, preparedActionId: string): Promise<string[]> {
    return (await this.client.auditEvent.findMany({
      where: { organizationId, subjectType: 'PREPARED_ACTION', subjectId: preparedActionId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })).map((event) => event.id);
  }

  async createPreparedAction(command: PreparedActionPersistence, identity: WorkforceIdentity): Promise<PersistedDraft> {
    const stable = digest(`${identity.organizationId}:${command.actionType}:${command.idempotencyKey}`);
    const actionId = `wfa_${stable.slice(0, 24)}`;
    const workflowRunId = `wfw_${stable.slice(0, 24)}`;
    const auditEventId = `audit_workforce_${stable.slice(0, 20)}`;
    const fingerprint = requestFingerprint(command);
    const existing = await this.findIdempotent(actionId, identity.organizationId, fingerprint);
    if (existing) return existing;

    const policy = await this.getApprovalPolicy(command.actionType);
    const now = new Date();

    try {
      await this.client.$transaction(async (transaction) => {
        const maxSequence = await transaction.auditEvent.aggregate({ _max: { sequence: true } });
        await transaction.workflowRun.create({
          data: {
            id: workflowRunId,
            organizationId: identity.organizationId,
            code: `WF-${command.actionType}-${stable.slice(0, 14).toUpperCase()}`,
            workflowType: command.workflowType,
            status: 'PREPARED',
            startedAt: now,
            completedAt: null,
            correlationId: `careflow-workforce:${stable}`,
          },
        });
        await transaction.preparedAction.create({
          data: {
            id: actionId,
            code: `PA-${command.actionType}-${stable.slice(0, 14).toUpperCase()}`,
            workflowRunId,
            actionType: command.actionType,
            requesterType: identity.actorType,
            requesterId: identity.subject,
            status: 'DRAFT',
            amountPaise: null,
            targetType: command.targetType,
            targetId: command.targetId,
            payloadJson: JSON.stringify(command.payload),
            evidenceJson: JSON.stringify({ ...command.evidence, requestFingerprint: fingerprint, idempotencyKey: command.idempotencyKey }),
            reasoningSummary: command.rationaleSummary,
            preparedAt: now,
          },
        });
        await transaction.auditEvent.create({
          data: {
            id: auditEventId,
            organizationId: identity.organizationId,
            sequence: (maxSequence._max.sequence ?? 0) + 1,
            eventType: 'WORKFORCE_ACTION_PREPARED',
            actorType: identity.actorType,
            actorId: identity.subject,
            subjectType: 'PREPARED_ACTION',
            subjectId: actionId,
            occurredAt: now,
            detailsJson: JSON.stringify({
              actionType: command.actionType,
              executionRequestId: identity.executionRequestId,
              approvalRequired: true,
            }),
          },
        });
      });
    } catch (error) {
      const concurrent = await this.findIdempotent(actionId, identity.organizationId, fingerprint);
      if (concurrent) return concurrent;
      if (error instanceof WorkforceError) throw error;
      throw new WorkforceError('PREPARED_ACTION_PERSISTENCE_FAILED', 'The workforce draft could not be persisted safely.');
    }

    return {
      action: await this.getPreparedAction(identity.organizationId, actionId),
      policy,
      auditEventId,
    };
  }

  private async findIdempotent(actionId: string, organizationId: string, fingerprint: string): Promise<PersistedDraft | null> {
    const action = await this.client.preparedAction.findFirst({
      where: { id: actionId, workflowRun: { is: { organizationId } } },
      include: { workflowRun: true },
    });
    if (!action) return null;
    const persistedFingerprint = parseEvidence(action.evidenceJson).requestFingerprint;
    if (persistedFingerprint !== fingerprint) {
      throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'This organization already used the idempotency key for different workforce action content.');
    }
    const policy = await this.getApprovalPolicy(action.actionType);
    return {
      action: await this.getPreparedAction(organizationId, action.id),
      policy,
      auditEventId: `audit_workforce_${action.id.replace(/^wfa_/, '').slice(0, 20)}`,
    };
  }
}
