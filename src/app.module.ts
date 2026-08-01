import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module.js';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module.js';
import { WorkforceModule } from './modules/workforce/workforce.module.js';
import { SystemHealthCheck } from './health/system.health.js';
import { ProcurementModule } from './modules/procurement/procurement.module.js';
import { ApprovalModule } from './modules/approval/approval.module.js';

/**
 * Root Application Module
 *
 * This is the main module that bootstraps the MCP server.
 * It registers all feature modules and health checks.
 */
@McpApp({
  module: AppModule,
  server: {
    name: 'careflow-logistics',
    version: '1.0.0'
  },
  logging: {
    level: 'info'
  }
})
@Module({
  name: 'app',
  description: 'Root application module',
  imports: [
    ConfigModule.forRoot(),
    PharmacyModule,
    ProcurementModule,
    ApprovalModule,
    OrchestratorModule,
    WorkforceModule
  ],
  providers: [
    SystemHealthCheck,
  ]
})
export class AppModule {}
