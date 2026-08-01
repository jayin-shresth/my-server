import { Module } from '@nitrostack/core';
import { prisma } from '../../data/client.js';
import { OrchestratorPrompts } from './orchestrator.prompts.js';
import { ORCHESTRATOR_PRISMA, OrchestratorRepository } from './orchestrator.repository.js';
import { RuntimeCareFlowToolRegistry } from './orchestrator.registry.js';
import { OrchestratorResources } from './orchestrator.resources.js';
import { OrchestratorService } from './orchestrator.service.js';
import { OrchestratorTools } from './orchestrator.tools.js';

@Module({
  name: 'careflow-orchestrator',
  description: 'Validates and persists CareFlow handoffs for host-model-driven hospital operations workflows.',
  controllers: [OrchestratorTools, OrchestratorResources, OrchestratorPrompts],
  providers: [
    { provide: ORCHESTRATOR_PRISMA, useValue: prisma },
    OrchestratorRepository,
    RuntimeCareFlowToolRegistry,
    OrchestratorService,
  ],
})
export class OrchestratorModule {}
