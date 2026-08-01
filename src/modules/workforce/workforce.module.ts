import { Module } from '@nitrostack/core';
import { prisma } from '../../data/client.js';
import { WorkforcePolicyEvaluator } from './workforce.policy.js';
import { WorkforceRosterPlanner } from './workforce.planner.js';
import { WorkforcePrompts } from './workforce.prompts.js';
import { WORKFORCE_PRISMA, WorkforceRepository } from './workforce.repository.js';
import { WorkforceResources } from './workforce.resources.js';
import { WorkforceService } from './workforce.service.js';
import { WorkforceTools } from './workforce.tools.js';

@Module({
  name: 'careflow-workforce',
  description: 'Organization-scoped deterministic workforce analysis, roster planning, and approval-gated action preparation.',
  controllers: [WorkforceTools, WorkforceResources, WorkforcePrompts],
  providers: [
    { provide: WORKFORCE_PRISMA, useValue: prisma },
    WorkforceRepository,
    WorkforcePolicyEvaluator,
    WorkforceRosterPlanner,
    WorkforceService,
  ],
  exports: [WorkforceService],
})
export class WorkforceModule {}
