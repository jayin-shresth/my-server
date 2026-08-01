'use client';

import { useTheme, useWidgetSDK } from '@nitrostack/widgets';
import { IntentBrokerChat, type BrokerAgent, type BrokerHandoffStatus } from '../../components/intent-broker';

type RouterData = {
  workspace?: string;
  specialists?: BrokerAgent[];
  handoff?: BrokerHandoffStatus;
};

export default function AgentRouterPage() {
  const theme = useTheme();
  const { isReady, getToolOutput, sendFollowUpMessage } = useWidgetSDK();
  const data = getToolOutput<RouterData>();

  const submitToCareFlow = async (request: string) => {
    if (!isReady) throw new Error('The CareFlow host connection is not ready.');
    await sendFollowUpMessage(`[CareFlow operations request]
Start or continue the careflow_orchestrator_session protocol. List verified capabilities, classify one CareFlow workflow, resolve required stable IDs, persist one structured handoff, and call only the server-returned nextTool when the handoff is READY. Stop for missing information, unavailable capabilities, or human approval.

User outcome:
${request}`);
  };

  return (
    <div style={{ minHeight: '100vh', overflow: 'hidden', background: theme === 'dark' ? 'radial-gradient(circle at 50% -20%, #1b2135 0, #0b1018 48%)' : 'radial-gradient(circle at 50% -20%, #e6f7f4 0, #f5f7fa 45%, #edf1f5 100%)' }}>
      <IntentBrokerChat
        workspace={data?.workspace ?? 'CareFlow admin'}
        agents={data?.specialists ?? []}
        connected={isReady}
        handoff={data?.handoff}
        onSubmitRequest={submitToCareFlow}
      />
    </div>
  );
}
