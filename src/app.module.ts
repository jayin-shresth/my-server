import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module.js';
import { WorkforceModule } from './modules/workforce/workforce.module.js';
import { SystemHealthCheck } from './health/system.health.js';

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
    OrchestratorModule,
    WorkforceModule
  ],
  providers: [
    // Health Checks
    SystemHealthCheck,
  ]
})
export class AppModule {}

