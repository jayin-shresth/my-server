import { Injectable, NitroStackServer } from '@nitrostack/core';

export interface CareFlowToolRegistry {
  registeredToolNames(): ReadonlySet<string>;
}

@Injectable({ deps: [NitroStackServer] })
export class RuntimeCareFlowToolRegistry implements CareFlowToolRegistry {
  constructor(private readonly server: NitroStackServer) {}

  registeredToolNames(): ReadonlySet<string> {
    // NitroStack 1.0.x does not expose a public registry accessor. Read its live
    // registration map and fail closed if that implementation detail changes.
    const registry = (this.server as unknown as { tools?: Map<string, unknown> }).tools;
    return registry instanceof Map ? new Set(registry.keys()) : new Set();
  }
}
