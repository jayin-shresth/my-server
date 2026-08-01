'use client';

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { BrokerAgent, BrokerHandoffStatus, BrokerTransport } from './types';
import styles from './intent-broker.module.css';

type Message = { id: string; role: 'user' | 'broker'; text: string; time: Date; status?: string };
type Props = {
  workspace: string;
  agents: BrokerAgent[];
  connected: boolean;
  handoff?: BrokerHandoffStatus;
  onSubmitRequest: BrokerTransport;
  onExpand?: () => void;
};

const suggestions = [
  'Open today\'s CareFlow control tower.',
  'Resolve the ICU shortage REQ-ICU-2026-001.',
  'Build the ICU roster for week 2026-07-13.',
  'Fill shift-icu-20260709-day without overtime.',
  'Review the pending procurement approval.',
  'Inspect the confirmed recall exposure.',
];
let fallbackId = 0;
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `careflow-message-${Date.now()}-${++fallbackId}`;

export function IntentBrokerChat({ workspace, agents, connected, handoff, onSubmitRequest, onExpand }: Props) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([{
    id: makeId(),
    role: 'broker',
    time: new Date(),
    text: 'Describe a CareFlow operations outcome. I will send it to the host conversation, where the model can classify it and persist a governed routing handoff.',
  }]);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const availableCount = agents.filter((agent) => agent.status === 'available').length;

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  }, [messages, submitting]);

  const submitRequest = async (raw: string) => {
    const text = raw.trim();
    if (!text || submitting || !connected) return;
    setDraft('');
    setError(null);
    setSubmitting(true);
    setMessages((current) => [...current, { id: makeId(), role: 'user', text, time: new Date(), status: 'sent' }]);
    try {
      await onSubmitRequest(text);
      setMessages((current) => [...current, {
        id: makeId(),
        role: 'broker',
        time: new Date(),
        text: 'Sent to the CareFlow conversation. The host model will display the routing result.',
      }]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(/rpc timeout|sendfollowupmessage|invalid request/i.test(message)
        ? 'NitroStudio Chat is unavailable. Configure a working AI provider in Studio, or test CareFlow from the Tools screen.'
        : message || 'The CareFlow host did not accept this request.');
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void submitRequest(draft); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitRequest(draft);
    }
  };

  return (
    <section className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><i /><i /><i /></div>
          <div><strong>CareFlow</strong><span>Hospital operations orchestrator.</span></div>
        </div>
        <div className={styles.workspace}><span>Workspace</span><strong>{workspace}</strong></div>
        <div className={styles.sectionTitle}><span>Specialists</span><em>{availableCount}/{agents.length} available</em></div>
        <div className={styles.agentList}>
          {agents.length ? agents.map((agent, index) => {
            const operationCount = agent.operations.filter((operation) => operation.available).length;
            return (
              <div className={styles.agentRow} key={agent.id} title={agent.unavailableReason ?? agent.description}>
                <div className={styles.agentIcon} data-index={index % 4}>{agent.name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div>
                <div><strong>{agent.name}</strong><span>{operationCount}/{agent.operations.length} tools available</span></div>
                <i data-status={agent.status} />
              </div>
            );
          }) : <div className={styles.emptyState}>Capability data is unavailable. Open this widget from <code>open_agent_router</code>.</div>}
        </div>
        <div className={styles.policy}><b>H</b><div><strong>Human approval enforced</strong><span>Routing never approves or executes an action.</span></div></div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.avatar}>C<i /></div>
          <div><h1>CareFlow Orchestrator</h1><p><span /> Full reasoning and results appear in the host conversation</p></div>
          <div className={styles.mode}>{connected ? 'MCP connected' : 'Waiting for host'}</div>
          {onExpand ? <button onClick={onExpand} type="button" aria-label="Open fullscreen">Open</button> : null}
        </header>
        <div className={styles.pipeline} aria-label="CareFlow orchestration stages">
          {['Understand', 'Route', 'Prepare', 'Approve', 'Execute'].map((stage, index) => (
            <div key={stage}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{stage}</strong></span></div>
          ))}
        </div>

        <div className={styles.feed} ref={feedRef} aria-live="polite">
          <div className={styles.today}><span>CareFlow session</span></div>
          {!connected ? <div className={styles.stateCard} data-tone="blocked"><strong>Host connection required</strong><span>Submission is disabled until the NitroStack widget SDK is ready.</span></div> : null}
          {agents.length > 0 && availableCount === 0 ? <div className={styles.stateCard} data-tone="unavailable"><strong>Specialist tools unavailable</strong><span>The router can persist blocked handoffs, but no downstream CareFlow provider is verified in this deployment.</span></div> : null}
          {handoff?.status === 'BLOCKED' ? <div className={styles.stateCard} data-tone="blocked"><strong>Handoff blocked</strong><span>{handoff.missingInformation.join(' ')}</span></div> : null}
          {handoff && ['FAILED', 'CANCELLED'].includes(handoff.status) ? <div className={styles.stateCard} data-tone="error"><strong>Handoff {handoff.status.toLowerCase()}</strong><span>Review the authoritative status in the host conversation.</span></div> : null}
          {messages.map((message) => (
            <article className={`${styles.message} ${message.role === 'user' ? styles.user : ''}`} key={message.id}>
              {message.role === 'broker' ? <div className={styles.smallAvatar}>C</div> : null}
              <div className={styles.messageBody}>
                {message.role === 'broker' ? <div className={styles.messageName}>CareFlow <span>Orchestrator</span></div> : null}
                <div className={styles.bubble}>{message.text}</div>
                <div className={styles.time}>{message.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{message.status ? <span>{message.status}</span> : null}</div>
              </div>
            </article>
          ))}
          {submitting ? <article className={styles.message}><div className={styles.smallAvatar}>C</div><div className={styles.thinking}><i /><i /><i /><span>Sending to the CareFlow conversation</span></div></article> : null}
          {error ? <div className={styles.error}><b>!</b><span>{error}</span><button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
        </div>

        <footer className={styles.composerArea}>
          {messages.length === 1 ? <div className={styles.suggestions}>{suggestions.map((text) => <button type="button" disabled={!connected || submitting} key={text} onClick={() => void submitRequest(text)}>{text}<span>+</span></button>)}</div> : null}
          <form className={styles.composer} onSubmit={submit}>
            <b>CF</b>
            <textarea ref={inputRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} placeholder={connected ? 'Describe a CareFlow operations outcome...' : 'Waiting for the host connection...'} aria-label="Describe a CareFlow operations outcome" disabled={!connected || submitting} />
            <button type="submit" disabled={!connected || !draft.trim() || submitting} aria-label="Send to CareFlow conversation">Send</button>
          </form>
          <p>Enter to send | Shift + Enter for a new line | Full results stay in the host conversation</p>
        </footer>
      </main>
    </section>
  );
}
