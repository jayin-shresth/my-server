'use client';

import { useState } from 'react';
import { useTheme, useWidgetSDK } from '@nitrostack/widgets';
import styles from './workforce-coordinator.module.css';

type Staff = { staffId: string; employeeCode: string; displayName: string };
type Assignment = { assignmentId: string; status: string; staff: Staff };
type Coverage = {
  shiftId: string;
  shiftCode: string;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  requiredHeadcount: number;
  confirmedCoverage: number;
  absentCoverage: number;
  proposedCoverage: number;
  gapSize: number;
  assignments: Assignment[];
};
type Candidate = {
  staffId: string;
  employeeCode: string;
  displayName: string;
  eligible: boolean;
  reasonCodes: string[];
  currentWeeklyHours: number;
  resultingWeeklyHours: number;
  homeLocationMatch: boolean;
  recentShiftTypeContinuity: boolean;
  finalRank: number | null;
  recommended: boolean;
};
type Plan = {
  week: { startsOn: string; endsOn: string };
  proposedAssignments: Array<{ shiftId: string; shiftCode: string; staffId: string; employeeCode: string; shiftType: string; startsAt: string }>;
  workloadDistribution: Array<{ staffId: string; employeeCode: string; currentMinutes: number; proposedMinutes: number; resultingHours: number; proposedShiftCount: number }>;
  uncoveredSlots: Array<{ shiftId: string; shiftCode: string; remainingPositions: number }>;
  ruleChecks: Array<{ rule: string; passed: boolean; evidence: string }>;
  planHash: string;
};
type PreparedAction = {
  preparedActionId: string;
  actionType: string;
  status: string;
  action: { targetType: string; targetId: string; preparedAt: string; rationaleSummary: string; payload: Record<string, unknown> };
  approvalRequirement: { requiredRoleCode: string; requiredApprovals: number };
  approvalState: string;
  executionState: string;
  evidenceSummary: string[];
  auditReferences: string[];
};
type Workload = {
  staff: Staff;
  assignedHours: number;
  shiftCount: number;
  consecutiveShifts: number;
  consecutiveNightShifts: number;
};
type ToolOutput = {
  view?: string;
  roster?: { location: { name: string }; week: { startsOn: string; endsOn: string }; shifts: Coverage[]; summary: { requiredPositions: number; confirmedCoverage: number; absentCoverage: number; openPositions: number } };
  shifts?: Coverage[];
  coverage?: Coverage;
  evaluation?: { shift: Coverage; candidates: Candidate[]; recommendedCandidate: Candidate | null };
  analysis?: { gap: Coverage; evaluatedCandidates: Candidate[]; recommendedCandidate: Candidate | null; explanation: string; nextPermittedAction: string };
  plan?: Plan;
  workload?: Workload;
  preparedAction?: PreparedAction;
  boundary?: string;
};

const hours = (minutes: number) => `${minutes / 60}h`;
const time = (value: string) => new Intl.DateTimeFormat([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function CoveragePill({ shift }: { shift: Coverage }) {
  const tone = shift.gapSize > 0 ? 'gap' : shift.proposedCoverage > 0 ? 'proposed' : 'covered';
  return <span className={styles.coveragePill} data-tone={tone}>{shift.confirmedCoverage}/{shift.requiredHeadcount}{shift.gapSize ? ` · gap ${shift.gapSize}` : ''}</span>;
}

export default function WorkforceCoordinatorPage() {
  const theme = useTheme();
  const { isReady, getToolOutput, sendFollowUpMessage } = useWidgetSDK();
  const data = getToolOutput<ToolOutput>();
  const [sending, setSending] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const rosterShifts = data?.roster?.shifts ?? data?.shifts ?? (data?.coverage ? [data.coverage] : []);
  const coverage = data?.analysis?.gap ?? data?.evaluation?.shift ?? data?.coverage ?? rosterShifts.find((shift) => shift.gapSize > 0);
  const candidates = data?.analysis?.evaluatedCandidates ?? data?.evaluation?.candidates ?? [];
  const recommended = data?.analysis?.recommendedCandidate ?? data?.evaluation?.recommendedCandidate ?? null;
  const prepared = data?.preparedAction;
  const preparedCandidate = typeof prepared?.action.payload.candidateStaffId === 'string' ? prepared.action.payload.candidateStaffId : null;
  const preparedLocation = typeof prepared?.action.payload.locationId === 'string' ? prepared.action.payload.locationId : null;
  const preparedWeek = typeof prepared?.action.payload.weekStart === 'string' ? prepared.action.payload.weekStart : null;
  const preparedPlanHash = typeof prepared?.action.payload.planHash === 'string' ? prepared.action.payload.planHash : null;

  const askChat = async () => {
    if (!isReady || sending) return;
    setSending(true);
    setInteractionError(null);
    try {
      if (prepared) {
        await sendFollowUpMessage(`Review workforce prepared action ${prepared.preparedActionId} using get_workforce_prepared_action. Explain its evidence and approval state. Do not approve or execute it.`);
      } else if (data?.plan) {
        await sendFollowUpMessage(`Review workforce roster plan ${data.plan.planHash}. Summarize workload balance and hard-rule evidence. Do not prepare publication unless I explicitly confirm in the conversation.`);
      } else if (recommended && coverage) {
        await sendFollowUpMessage(`Review the authoritative analysis for shift ${coverage.shiftId} and candidate ${recommended.staffId}. Explain the deterministic eligibility evidence. Do not prepare reassignment unless I explicitly ask in the conversation.`);
      } else if (coverage) {
        await sendFollowUpMessage(`Analyze the authoritative staffing state for shift ${coverage.shiftId}. Explain deterministic evidence and stop at any approval boundary.`);
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

  if (!isReady) return <main className={styles.loading}>Connecting to the CareFlow workforce host…</main>;
  if (!data) return <main className={styles.loading}>Invoke a CareFlow workforce tool to display authoritative results.</main>;

  return (
    <main className={styles.canvas} data-theme={theme}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brandMark}><i /><i /><i /></div>
          <div><span className={styles.eyebrow}>CareFlow operations</span><h1>Workforce Coordinator</h1></div>
          <span className={styles.connected}>MCP connected</span>
        </header>

        <div className={styles.boundary} data-mode={prepared ? 'approval' : 'readonly'}>
          <b>{prepared ? 'Approval required' : 'Read-only result'}</b>
          <span>{prepared
            ? 'This draft requires authorized human approval before execution.'
            : 'Analysis and planning do not change assignments. Only explicitly prepared actions enter human review.'}</span>
        </div>

        <div className={styles.content}>
          {(data.roster || rosterShifts.length > 0) && <section className={styles.panel}>
            <div className={styles.panelTitle}><div><span>Roster coverage</span><h2>{data.roster?.location.name ?? coverage?.shiftCode ?? 'Workforce shifts'}</h2></div>{data.roster && <em>{data.roster.week.startsOn} — {data.roster.week.endsOn}</em>}</div>
            {data.roster && <div className={styles.metrics}>
              <div><span>Required</span><strong>{data.roster.summary.requiredPositions}</strong></div>
              <div><span>Confirmed</span><strong>{data.roster.summary.confirmedCoverage}</strong></div>
              <div><span>Absent</span><strong>{data.roster.summary.absentCoverage}</strong></div>
              <div data-alert={data.roster.summary.openPositions > 0}><span>Open</span><strong>{data.roster.summary.openPositions}</strong></div>
            </div>}
            <div className={styles.shiftGrid}>
              {rosterShifts.map((shift) => <article className={styles.shiftCard} key={shift.shiftId} data-gap={shift.gapSize > 0}>
                <div><b>{time(shift.startsAt)}</b><span>{shift.shiftType}</span></div>
                <CoveragePill shift={shift} />
                <small>{shift.shiftCode}</small>
              </article>)}
            </div>
          </section>}

          {coverage && coverage.gapSize > 0 && <section className={`${styles.panel} ${styles.alertPanel}`}>
            <div className={styles.alertIcon}>!</div>
            <div><span className={styles.eyebrow}>Known staffing gap</span><h2>{coverage.shiftCode}</h2><p>{data.analysis?.explanation ?? `${coverage.confirmedCoverage} confirmed of ${coverage.requiredHeadcount}; ${coverage.gapSize} position remains open.`}</p></div>
            <CoveragePill shift={coverage} />
          </section>}

          {candidates.length > 0 && <section className={styles.panel}>
            <div className={styles.panelTitle}><div><span>Deterministic comparison</span><h2>Replacement candidates</h2></div><em>{recommended ? `${recommended.employeeCode} recommended` : 'No eligible candidate'}</em></div>
            <div className={styles.candidateTable}>
              <div className={styles.tableHead}><span>Candidate</span><span>Eligibility</span><span>Workload</span><span>Evidence</span></div>
              {candidates.map((candidate) => <article key={candidate.staffId} data-recommended={candidate.recommended}>
                <div><b>{candidate.displayName}</b><small>{candidate.employeeCode}{candidate.finalRank ? ` · rank ${candidate.finalRank}` : ''}</small></div>
                <span className={styles.badge} data-eligible={candidate.eligible}>{candidate.eligible ? 'Eligible' : 'Rejected'}</span>
                <div className={styles.workload}><b>{candidate.currentWeeklyHours}h</b><i>→</i><strong>{candidate.resultingWeeklyHours}h</strong></div>
                <div className={styles.reasons}>{candidate.reasonCodes.map((reason) => <span key={reason}>{reason.replaceAll('_', ' ')}</span>)}</div>
              </article>)}
            </div>
          </section>}

          {data.workload && <section className={styles.panel}>
            <div className={styles.panelTitle}><div><span>Weekly workload</span><h2>{data.workload.staff.displayName}</h2></div><em>{data.workload.staff.employeeCode}</em></div>
            <div className={styles.metrics}>
              <div><span>Hours</span><strong>{data.workload.assignedHours}</strong></div><div><span>Shifts</span><strong>{data.workload.shiftCount}</strong></div><div><span>Consecutive</span><strong>{data.workload.consecutiveShifts}</strong></div><div><span>Night run</span><strong>{data.workload.consecutiveNightShifts}</strong></div>
            </div>
          </section>}

          {data.plan && <section className={styles.panel}>
            <div className={styles.panelTitle}><div><span>Deterministic weekly plan</span><h2>{data.plan.proposedAssignments.length} proposed assignments</h2></div><em>{data.plan.uncoveredSlots.length ? `${data.plan.uncoveredSlots.length} uncovered` : 'Complete coverage'}</em></div>
            <div className={styles.planHash}><span>Plan hash</span><code>{data.plan.planHash}</code></div>
            <div className={styles.distribution}>{data.plan.workloadDistribution.map((staff) => <div key={staff.staffId}><span>{staff.employeeCode}</span><b>{staff.proposedShiftCount} shifts</b><em>{hours(staff.proposedMinutes)}</em><i style={{ width: `${Math.min(100, (staff.resultingHours / 48) * 100)}%` }} /></div>)}</div>
            <div className={styles.ruleChecks}>{data.plan.ruleChecks.map((check) => <span key={check.rule} data-pass={check.passed}>{check.passed ? '✓' : '!'} {check.rule.replaceAll('_', ' ')}</span>)}</div>
          </section>}

          {prepared && <section className={`${styles.panel} ${styles.preparedPanel}`}>
            <div className={styles.preparedTop}><div className={styles.lock}>H</div><div><span className={styles.eyebrow}>Prepared action</span><h2>{prepared.actionType.replaceAll('_', ' ')}</h2></div><span className={styles.status}>{prepared.status}</span></div>
            <p>{prepared.action.rationaleSummary}</p>
            <dl>
              <div><dt>Action ID</dt><dd>{prepared.preparedActionId}</dd></div>
              <div><dt>Target</dt><dd>{prepared.action.targetId}</dd></div>
              {preparedCandidate && <div><dt>Candidate staff</dt><dd>{preparedCandidate}</dd></div>}
              {preparedLocation && <div><dt>Roster scope</dt><dd>{preparedLocation}{preparedWeek ? ` / ${preparedWeek}` : ''}</dd></div>}
              {preparedPlanHash && <div><dt>Verified plan hash</dt><dd>{preparedPlanHash}</dd></div>}
              <div><dt>Approval</dt><dd>{prepared.approvalState}</dd></div>
              <div><dt>Execution</dt><dd>{prepared.executionState}</dd></div>
              <div><dt>Required role</dt><dd>{prepared.approvalRequirement.requiredRoleCode} ({prepared.approvalRequirement.requiredApprovals})</dd></div>
            </dl>
            {prepared.evidenceSummary.length > 0 && <div className={styles.evidence}><b>Review evidence</b>{prepared.evidenceSummary.map((item) => <span key={item}>{item}</span>)}</div>}
            <div className={styles.stopLine}><b>Stop</b><span>This draft has not been approved, assigned, published, or executed.</span></div>
          </section>}
        </div>

        <footer className={styles.footer}>
          <span>Authoritative tool output · deterministic rules · no clinical decisions</span>
          {interactionError && <em className={styles.interactionError}>{interactionError}</em>}
          {(prepared || data.plan || coverage) && <button type="button" disabled={sending} onClick={() => void askChat()}>{sending ? 'Sending…' : prepared ? 'Review in NitroChat' : 'Ask NitroChat to review'}</button>}
        </footer>
      </section>
    </main>
  );
}
