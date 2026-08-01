export type BrokerOperation = {
  name: string;
  description: string;
  toolName: string;
  risk: 'READ_ONLY' | 'DRAFT' | 'GOVERNED_WRITE' | 'EXTERNAL_ACTION';
  approvalBoundary: string;
  available: boolean;
  unavailableReason: string | null;
};

export type BrokerAgent = {
  id: string;
  name: string;
  description: string;
  specialistPromptName: string;
  status: 'available' | 'unavailable';
  unavailableReason: string | null;
  operations: BrokerOperation[];
};

export type BrokerHandoffStatus = {
  requestId: string;
  status: 'PREPARED' | 'READY' | 'BLOCKED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
  missingInformation: string[];
  nextTool: string | null;
};

export type BrokerTransport = (message: string) => Promise<void>;
