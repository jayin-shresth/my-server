'use client';

import { useState } from 'react';
import { useTheme, useWidgetSDK } from '@nitrostack/widgets';
import styles from './inventory-control.module.css';

type StockStatus = 'critical' | 'low' | 'normal' | 'overstocked';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

type InventorySummary = {
  totalItems: number;
  criticalCount: number;
  lowCount: number;
  normalCount: number;
  overstockedCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  generatedAt: string;
};

type InventoryItem = {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  reorderThreshold: number;
  maxCapacity: number;
  unit: string;
  expiryDate: string;
  lastRestockedAt: string;
  status: StockStatus;
  daysUntilExpiry: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
};

type Recommendation = {
  priority: Priority;
  itemId: string;
  itemName: string;
  reason: string;
  recommendedAction: string;
  suggestedOrderQuantity: number;
};

type ProcurementAction = {
  workflowRunId: string;
  preparedActionId: string;
  approvalRequestId: string;
  approvalPolicyId: string;
  itemName: string;
  supplierName: string;
  quantity: number;
  estimatedCostPaise: number;
  requiredRoleCode: string;
  requiredApprovals: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'EXECUTED';
};

type ApprovalResult = {
  approvalRequestId: string;
  preparedActionId: string;
  purchaseOrderId: string | null;
  actionExecutionId: string | null;
  status: 'APPROVED' | 'REJECTED';
  message: string;
};

type ToolOutput = {
  summary?: InventorySummary;
  items?: InventoryItem[];
  recommendations?: Recommendation[];
  actions?: ProcurementAction[];
  approvalRequestId?: string;
  preparedActionId?: string;
  purchaseOrderId?: string | null;
  actionExecutionId?: string | null;
  status?: ApprovalResult['status'];
  message?: string;
};

const titleCase = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value: string) => new Intl.DateTimeFormat([], { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const formatMoney = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);

function BrandMark() {
  return <div className={styles.brandMark} aria-hidden="true"><i /><i /><i /></div>;
}

function StockMeter({ item }: { item: InventoryItem }) {
  const capacity = Math.max(item.maxCapacity, item.reorderThreshold, 1);
  const stockWidth = Math.min(100, Math.max(2, (item.currentStock / capacity) * 100));
  const thresholdLeft = Math.min(100, (item.reorderThreshold / capacity) * 100);

  return (
    <div className={styles.stockMeter} aria-label={`${item.currentStock} of ${item.maxCapacity} ${item.unit} in stock`}>
      <i style={{ width: `${stockWidth}%` }} data-status={item.status} />
      <b style={{ left: `${thresholdLeft}%` }} title="Reorder threshold" />
    </div>
  );
}

export default function InventoryControlPage() {
  const theme = useTheme();
  const { isReady, getToolOutput, sendFollowUpMessage } = useWidgetSDK();
  const data = getToolOutput<ToolOutput>();
  const [sending, setSending] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);

  const items = data?.items ?? [];
  const recommendations = data?.recommendations ?? [];
  const actions = data?.actions ?? [];
  const approval = data?.approvalRequestId && data.status && data.message ? data as ApprovalResult : null;
  const hasApprovalBoundary = actions.length > 0;

  const askChat = async () => {
    if (!isReady || !data || sending) return;
    setSending(true);
    setInteractionError(null);
    try {
      if (approval) {
        await sendFollowUpMessage(`Summarize the authoritative procurement decision for approval request ${approval.approvalRequestId}. Include the purchase order and execution references when present.`);
      } else if (actions.length > 0) {
        await sendFollowUpMessage(`Review the ${actions.length} prepared procurement action${actions.length === 1 ? '' : 's'} shown by CareFlow. Explain cost, supplier, and approval requirements. Do not approve or execute anything unless I explicitly instruct you in the conversation.`);
      } else if (recommendations.length > 0) {
        await sendFollowUpMessage('Review these pharmacy reorder recommendations. Prioritize operational risk and explain suggested quantities. Do not prepare procurement actions unless I explicitly confirm in the conversation.');
      } else {
        await sendFollowUpMessage('Review this authoritative pharmacy inventory snapshot. Summarize critical, low-stock, expired, and expiring-soon items. Do not modify inventory or prepare procurement actions.');
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setInteractionError(/rpc timeout|sendfollowupmessage|invalid request/i.test(message)
        ? 'NitroStudio Chat is unavailable. Configure a working AI provider, or continue from the Tools screen.'
        : message || 'The host conversation did not accept this request.');
    } finally {
      setSending(false);
    }
  };

  if (!isReady) return <main className={styles.loading}>Connecting to the CareFlow inventory host...</main>;
  if (!data) return <main className={styles.loading}>Invoke a CareFlow inventory tool to display authoritative results.</main>;

  return (
    <main className={styles.canvas} data-theme={theme}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <BrandMark />
          <div><span className={styles.eyebrow}>CareFlow operations</span><h1>Inventory Control</h1></div>
          <span className={styles.connected}><i /> MCP connected</span>
        </header>

        <div className={styles.boundary} data-mode={approval ? approval.status.toLowerCase() : hasApprovalBoundary ? 'approval' : 'readonly'}>
          <b>{approval ? approval.status : hasApprovalBoundary ? 'Approval required' : 'Read-only result'}</b>
          <span>{approval
            ? approval.status === 'APPROVED' ? 'The authorized decision executed synchronously and created the referenced purchase order.' : 'The request was rejected and no purchase order was created.'
            : hasApprovalBoundary ? 'These procurement drafts cannot execute until an authorized administrator approves them.'
            : 'Stock analysis and recommendations do not change inventory or create purchase orders.'}</span>
        </div>

        <div className={styles.content}>
          {data.summary && <section className={styles.overview}>
            <div className={styles.overviewCopy}>
              <span className={styles.eyebrow}>Inventory pulse</span>
              <h2>{data.summary.criticalCount > 0 ? `${data.summary.criticalCount} critical item${data.summary.criticalCount === 1 ? '' : 's'} need attention` : 'Inventory is operating within critical limits'}</h2>
              <p>Authoritative pharmacy stock position generated {formatDate(data.summary.generatedAt)}.</p>
            </div>
            <div className={styles.metrics}>
              <div><span>Total items</span><strong>{data.summary.totalItems}</strong><i data-tone="neutral" /></div>
              <div><span>Critical</span><strong>{data.summary.criticalCount}</strong><i data-tone="critical" /></div>
              <div><span>Low stock</span><strong>{data.summary.lowCount}</strong><i data-tone="low" /></div>
              <div><span>Expiry risk</span><strong>{data.summary.expiredCount + data.summary.expiringSoonCount}</strong><i data-tone="expiry" /></div>
            </div>
          </section>}

          {items.length > 0 && <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div><span>Stock position</span><h2>Pharmacy inventory</h2></div>
              <em>{items.length} item{items.length === 1 ? '' : 's'} in this view</em>
            </div>
            <div className={styles.inventoryGrid}>
              {items.map((item) => <article className={styles.itemCard} key={item.id} data-status={item.status}>
                <div className={styles.itemTop}>
                  <div className={styles.itemIdentity}><span>{item.category}</span><h3>{item.name}</h3><small>{item.id}</small></div>
                  <span className={styles.statusBadge} data-status={item.status}>{titleCase(item.status)}</span>
                </div>
                <div className={styles.stockValue}><strong>{item.currentStock.toLocaleString()}</strong><span>{item.unit}</span><em>of {item.maxCapacity.toLocaleString()} capacity</em></div>
                <StockMeter item={item} />
                <div className={styles.itemFacts}>
                  <div><span>Reorder at</span><b>{item.reorderThreshold.toLocaleString()} {item.unit}</b></div>
                  <div data-alert={item.isExpired || item.isExpiringSoon}><span>{item.isExpired ? 'Expired' : 'Expires'}</span><b>{formatDate(item.expiryDate)}</b></div>
                </div>
              </article>)}
            </div>
          </section>}

          {recommendations.length > 0 && <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div><span>Read-only guidance</span><h2>Reorder recommendations</h2></div>
              <em>{recommendations.filter((item) => item.priority === 'HIGH').length} high priority</em>
            </div>
            <div className={styles.recommendationList}>
              {recommendations.map((recommendation, index) => <article key={`${recommendation.itemId}-${index}`} data-priority={recommendation.priority.toLowerCase()}>
                <div className={styles.priorityRail}><span>{recommendation.priority}</span><i /></div>
                <div className={styles.recommendationCopy}><span>{recommendation.itemId}</span><h3>{recommendation.itemName}</h3><p>{recommendation.reason}</p><b>{recommendation.recommendedAction}</b></div>
                <div className={styles.orderQuantity}><span>Suggested order</span><strong>{recommendation.suggestedOrderQuantity.toLocaleString()}</strong><small>units</small></div>
              </article>)}
            </div>
          </section>}

          {actions.length > 0 && <section className={`${styles.panel} ${styles.actionPanel}`}>
            <div className={styles.panelTitle}>
              <div><span>Governed procurement</span><h2>Prepared actions</h2></div>
              <em>{actions.length} awaiting human review</em>
            </div>
            <div className={styles.actionGrid}>
              {actions.map((action) => <article key={action.preparedActionId}>
                <div className={styles.actionTop}><div className={styles.documentIcon}>P</div><div><span>{action.preparedActionId}</span><h3>{action.itemName}</h3></div><span className={styles.pendingBadge}>{titleCase(action.status)}</span></div>
                <div className={styles.actionValue}><span>Estimated value</span><strong>{formatMoney(action.estimatedCostPaise)}</strong></div>
                <dl>
                  <div><dt>Supplier</dt><dd>{action.supplierName}</dd></div>
                  <div><dt>Quantity</dt><dd>{action.quantity.toLocaleString()}</dd></div>
                  <div><dt>Approval request</dt><dd>{action.approvalRequestId}</dd></div>
                  <div><dt>Required role</dt><dd>{action.requiredRoleCode}</dd></div>
                </dl>
                <div className={styles.approvalLine}><i /><span>{action.requiredApprovals} approval{action.requiredApprovals === 1 ? '' : 's'} required before execution</span></div>
              </article>)}
            </div>
          </section>}

          {approval && <section className={`${styles.panel} ${styles.decisionPanel}`} data-status={approval.status.toLowerCase()}>
            <div className={styles.decisionMark}>{approval.status === 'APPROVED' ? 'OK' : 'X'}</div>
            <div className={styles.decisionCopy}><span className={styles.eyebrow}>Procurement decision</span><h2>{approval.status === 'APPROVED' ? 'Purchase order created' : 'Request rejected'}</h2><p>{approval.message}</p></div>
            <dl>
              <div><dt>Approval request</dt><dd>{approval.approvalRequestId}</dd></div>
              <div><dt>Prepared action</dt><dd>{approval.preparedActionId}</dd></div>
              {approval.purchaseOrderId && <div><dt>Purchase order</dt><dd>{approval.purchaseOrderId}</dd></div>}
              {approval.actionExecutionId && <div><dt>Execution</dt><dd>{approval.actionExecutionId}</dd></div>}
            </dl>
          </section>}

          {!data.summary && items.length === 0 && recommendations.length === 0 && actions.length === 0 && !approval && <section className={`${styles.panel} ${styles.empty}`}><div>i</div><h2>No displayable inventory records</h2><p>The tool completed without inventory, recommendation, procurement, or approval records.</p></section>}
        </div>

        <footer className={styles.footer}>
          <span>Authoritative inventory data · governed procurement · human approval</span>
          {interactionError && <em className={styles.interactionError}>{interactionError}</em>}
          <button type="button" disabled={sending} onClick={() => void askChat()}>{sending ? 'Sending...' : approval ? 'Review decision in NitroChat' : actions.length ? 'Review actions in NitroChat' : 'Ask NitroChat to review'}</button>
        </footer>
      </section>
    </main>
  );
}
