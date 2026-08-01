import { ExecutionContext, Injectable, ResourceDecorator as Resource } from '@nitrostack/core';
import { OrchestratorService } from './orchestrator.service.js';

@Injectable({ deps: [OrchestratorService] })
export class OrchestratorResources {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Resource({
    uri: 'careflow://orchestrator/capabilities',
    name: 'CareFlow Orchestration Catalog',
    description: 'Authoritative three-specialist workflow routes, registered operation availability, required roster inputs, risk, and approval boundaries.',
    mimeType: 'application/json',
    annotations: { audience: ['assistant'], priority: 1 },
  })
  async capabilities(uri: string, ctx: ExecutionContext) {
    ctx.logger.info('Reading CareFlow capability resource', { requestId: ctx.requestId });
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(this.orchestrator.listCapabilities(), null, 2),
      }],
    };
  }
}
