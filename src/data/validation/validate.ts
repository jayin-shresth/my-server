import { readFile } from "node:fs/promises";
import { prisma } from "../client.js";
import { at, ICU_ITEM_ID, LOCATION_IDS, ORGANIZATION_ID } from "../seed/constants.js";
import {
  buildWeeklyRosterPlan,
  evaluateReplacementCandidates,
  getShiftCoverage,
} from "../workforce.js";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function validateCounts(): Promise<Record<string, number>> {
  const [organizations, locations, roles, activeUsers, items, suppliers, batches, assets, ledgerEntries] = await Promise.all([
    prisma.organization.count({ where: { id: ORGANIZATION_ID } }),
    prisma.location.count({ where: { organizationId: ORGANIZATION_ID, active: true } }),
    prisma.role.count({ where: { organizationId: ORGANIZATION_ID } }),
    prisma.user.count({ where: { organizationId: ORGANIZATION_ID, active: true } }),
    prisma.catalogItem.count({ where: { organizationId: ORGANIZATION_ID, active: true } }),
    prisma.supplier.count({ where: { organizationId: ORGANIZATION_ID, active: true } }),
    prisma.stockBatch.count(),
    prisma.asset.count(),
    prisma.inventoryLedgerEntry.count(),
  ]);
  check(organizations === 1, `Expected one CareFlow organization, found ${organizations}`);
  check(locations === 12, `Expected exactly 12 operational locations, found ${locations}`);
  check(roles === 7, `Expected exactly 7 roles, found ${roles}`);
  check(activeUsers === 15, `Expected exactly 15 active users, found ${activeUsers}`);
  check(items === 120, `Expected exactly 120 catalogue items, found ${items}`);
  check(suppliers >= 10 && suppliers <= 15, `Expected 10-15 suppliers, found ${suppliers}`);
  check(batches >= 200 && batches <= 300, `Expected 200-300 batches, found ${batches}`);
  check(assets >= 30 && assets <= 50, `Expected 30-50 assets, found ${assets}`);
  check(ledgerEntries >= 1_000 && ledgerEntries <= 2_000, `Expected 1,000-2,000 ledger entries, found ${ledgerEntries}`);

  const categories = await prisma.itemCategory.findMany({
    where: { organizationId: ORGANIZATION_ID },
    select: { id: true, _count: { select: { items: true } } },
  });
  const expectedDistribution = new Map([
    ["cat-pharma", 35], ["cat-surgical", 20], ["cat-medical", 20], ["cat-lab", 12], ["cat-ppe", 10],
    ["cat-linen", 8], ["cat-gas", 5], ["cat-biomed", 5], ["cat-admin", 5],
  ]);
  for (const category of categories) {
    check(category._count.items === expectedDistribution.get(category.id), `Category ${category.id} has unexpected item count ${category._count.items}`);
  }
  return { organizations, locations, roles, activeUsers, items, suppliers, batches, assets, ledgerEntries };
}

async function validateUniqueness(): Promise<void> {
  const codeSets = await Promise.all([
    prisma.location.findMany({ select: { code: true } }),
    prisma.role.findMany({ select: { code: true } }),
    prisma.catalogItem.findMany({ select: { sku: true } }),
    prisma.supplier.findMany({ select: { code: true } }),
    prisma.inventoryTransaction.findMany({ select: { code: true } }),
    prisma.purchaseOrder.findMany({ select: { code: true } }),
  ]);
  for (const records of codeSets) {
    const values = records.map((record) => Object.values(record)[0]);
    check(values.length === new Set(values).size, "Duplicate unique business code detected");
  }
}

async function validateLedger(): Promise<void> {
  const grouped = await prisma.inventoryLedgerEntry.groupBy({
    by: ["positionKey"],
    _sum: { quantityBaseUnits: true },
  });
  const positions = await prisma.stockPosition.findMany({ select: { positionKey: true, quantityBaseUnits: true, stockStatus: true } });
  const positionMap = new Map(positions.map((position) => [position.positionKey, position.quantityBaseUnits]));
  for (const group of grouped) {
    check(positionMap.get(group.positionKey) === (group._sum.quantityBaseUnits ?? 0), `Ledger and StockPosition differ for ${group.positionKey}`);
  }
  check(grouped.length === positions.length, "StockPosition contains a row not represented by the ledger");
  const negativePositions = positions.filter((position) => position.quantityBaseUnits < 0);
  check(negativePositions.length === 0, `Found ${negativePositions.length} negative stock positions`);

  const transactions = await prisma.inventoryTransaction.findMany({ include: { entries: true } });
  for (const transaction of transactions) {
    check(transaction.entries.length > 0, `Transaction ${transaction.code} has no ledger entries`);
    check(transaction.entries.every((entry) => entry.quantityBaseUnits !== 0), `Transaction ${transaction.code} contains a zero movement`);
    const net = sum(transaction.entries.map((entry) => entry.quantityBaseUnits));
    if (transaction.transactionType === "STATUS_CHANGE") check(net === 0, `Status transaction ${transaction.code} does not balance to zero`);
    if (transaction.transactionType === "OPENING_BALANCE" || transaction.transactionType === "GOODS_RECEIPT") check(net > 0, `Receipt/opening transaction ${transaction.code} is not positive`);
    if (transaction.transactionType === "ISSUE") check(net < 0, `Issue transaction ${transaction.code} is not negative`);
  }

  const reservations = await prisma.reservation.findMany({ where: { status: "ACTIVE" } });
  for (const reservation of reservations) {
    const reservedPosition = await prisma.stockPosition.findFirst({
      where: { itemId: reservation.itemId, locationId: reservation.locationId, batchId: reservation.batchId, reservationKey: reservation.code },
    });
    check((reservedPosition?.quantityBaseUnits ?? 0) >= reservation.quantityBaseUnits, `Reservation ${reservation.code} exceeds its reserved stock dimension`);
  }
  const serializedItems = await prisma.catalogItem.findMany({ where: { trackingMode: "SERIAL" }, include: { batches: true } });
  check(serializedItems.every((item) => item.batches.some((batch) => batch.serialNumber !== null)), "A serialized item lacks an individually identified stock record");
}

async function validateIcuScenario(): Promise<Record<string, number>> {
  const requirement = await prisma.requirement.findUniqueOrThrow({ where: { id: "requirement-icu-001" } });
  const positions = await prisma.stockPosition.findMany({
    where: { itemId: ICU_ITEM_ID, quantityBaseUnits: { gt: 0 } },
    include: { batch: true },
  });
  const policies = await prisma.locationItemPolicy.findMany({ where: { itemId: ICU_ITEM_ID } });
  const policyMap = new Map(policies.map((policy) => [policy.locationId, policy]));
  const minimumExpiry = at(14);
  const eligibleAt = (locationId: string): number => sum(
    positions
      .filter((position) => position.locationId === locationId)
      .filter((position) => position.stockStatus === "AVAILABLE" && position.reservationKey === "UNRESERVED")
      .filter((position) => {
        const expiresAt = position.batch?.expiresAt;
        return expiresAt !== null && expiresAt !== undefined && expiresAt >= minimumExpiry;
      })
      .map((position) => position.quantityBaseUnits),
  );
  const icuAvailable = eligibleAt(LOCATION_IDS.icu);
  const centralTransferable = Math.max(0, eligibleAt(LOCATION_IDS.central) - (policyMap.get(LOCATION_IDS.central)?.safetyStockBaseUnits ?? 0));
  const pharmacyTransferable = Math.max(0, eligibleAt(LOCATION_IDS.pharmacy) - (policyMap.get(LOCATION_IDS.pharmacy)?.safetyStockBaseUnits ?? 0));
  const centralProtected = eligibleAt(LOCATION_IDS.central) - centralTransferable;
  const pharmacyProtected = eligibleAt(LOCATION_IDS.pharmacy) - pharmacyTransferable;
  const internalFulfilment = icuAvailable + centralTransferable + pharmacyTransferable;
  const residual = requirement.requiredBaseUnits - internalFulfilment;
  check(requirement.requiredBaseUnits === 120, "ICU requirement is not 120 units");
  check(icuAvailable === 20, `ICU eligible availability should be 20, found ${icuAvailable}`);
  check(centralTransferable === 45, `Central transferable quantity should be 45, found ${centralTransferable}`);
  check(pharmacyTransferable === 25, `Pharmacy transferable quantity should be 25, found ${pharmacyTransferable}`);
  check(centralProtected === 40 && pharmacyProtected === 30, "Safety-stock-protected quantities do not reconcile to 40 and 30 units");
  check(internalFulfilment === 90, `Internal fulfilment should be 90, found ${internalFulfilment}`);
  check(residual === 30 && requirement.procurementGapBaseUnits === 30, `Residual procurement gap should be 30, found ${residual}`);
  const quarantined = positions.find((position) => position.batchId === "batch-icu-quarantine" && position.stockStatus === "QUARANTINED");
  check(quarantined?.quantityBaseUnits === 50, "The rejected ICU recall batch is not quarantined at 50 units");
  const reserved = positions.find((position) => position.reservationKey === "RES-OTHER-001");
  check(reserved?.quantityBaseUnits === 15, "The 15-unit reserved stock exclusion is missing");
  const expired = positions.find((position) => position.batchId === "batch-icu-expired");
  const expiredAt = expired?.batch?.expiresAt;
  check(expired?.quantityBaseUnits === 10 && expiredAt !== null && expiredAt !== undefined && expiredAt < at(0), "Expired stock exclusion is missing");
  const centralFefo = positions
    .filter((position) => position.locationId === LOCATION_IDS.central && position.stockStatus === "AVAILABLE" && position.quantityBaseUnits > 0)
    .filter((position) => {
      const expiresAt = position.batch?.expiresAt;
      return expiresAt !== null && expiresAt !== undefined && expiresAt >= minimumExpiry;
    })
    .sort((left, right) => (left.batch?.expiresAt?.getTime() ?? 0) - (right.batch?.expiresAt?.getTime() ?? 0))[0];
  check(centralFefo?.batchId === "batch-icu-near", `FEFO selected ${centralFefo?.batchId ?? "nothing"} instead of batch-icu-near`);
  return { required: 120, icuAvailable, centralTransferable, pharmacyTransferable, centralProtected, pharmacyProtected, internalFulfilment, residual };
}

async function validateProcurementAndReceiving(): Promise<Record<string, number>> {
  const rfqLine = await prisma.rfqLine.findUniqueOrThrow({ where: { id: "rfq-line-icu-001" }, include: { procurementNeed: true, requirement: true } });
  check(rfqLine.requirementId === "requirement-icu-001" && rfqLine.procurementNeed.requirementId === rfqLine.requirementId, "RFQ line is not traceable to the originating requirement");
  check(rfqLine.requestedBaseUnits === rfqLine.requirement.procurementGapBaseUnits, "RFQ quantity does not equal the residual procurement gap");
  const quotes = await prisma.quote.findMany({ where: { rfqId: "rfq-icu-001" }, include: { lines: true } });
  check(quotes.length === 4, `Expected exactly four quotes, found ${quotes.length}`);
  check(quotes.every((quote) => quote.lines.length === 1), "A procurement quote is not comparable on the RFQ line");
  check(quotes.filter((quote) => quote.recommended).length === 1 && quotes.find((quote) => quote.recommended)?.id === "quote-icu-02", "Recommended quote is not deterministic or unique");
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: "po-icu-001" }, include: { lines: true } });
  check(po.lines[0]?.orderedBaseUnits === 30 && po.subtotalPaise === 163_500 && po.gstPaise === 19_620 && po.totalPaise === 183_120, "ICU purchase order arithmetic does not reconcile");

  const receiptLine = await prisma.goodsReceiptLine.findUniqueOrThrow({ where: { id: "receipt-line-001" }, include: { discrepancies: true } });
  const shortQuantity = receiptLine.orderedBaseUnits - receiptLine.receivedBaseUnits;
  check(receiptLine.receivedBaseUnits === receiptLine.acceptedBaseUnits + receiptLine.rejectedBaseUnits, "Received does not equal accepted plus rejected");
  check(shortQuantity === 8, `Expected an 8-unit short shipment, found ${shortQuantity}`);
  const rejectedDiscrepancies = receiptLine.discrepancies.filter((item) => item.discrepancyType !== "SHORT_SHIPMENT");
  check(sum(rejectedDiscrepancies.map((item) => item.quantityBaseUnits)) === receiptLine.rejectedBaseUnits, "Rejected discrepancy quantities do not reconcile");
  const receivedLedger = await prisma.inventoryLedgerEntry.aggregate({ where: { transaction: { referenceType: "GOODS_RECEIPT", referenceId: "receipt-001" } }, _sum: { quantityBaseUnits: true } });
  check(receivedLedger._sum.quantityBaseUnits === receiptLine.acceptedBaseUnits, "Accepted receipt quantity is not recorded in the inventory ledger");
  return { ordered: 100, received: 92, accepted: 80, rejected: 12, short: 8 };
}

async function validateRecalls(): Promise<void> {
  const recalls = await prisma.recallNotice.findMany({ include: { affectedBatches: true, quarantineActions: true } });
  check(recalls.some((recall) => recall.classification === "CONFIRMED"), "Confirmed recall is missing");
  check(recalls.some((recall) => recall.classification === "PROBABLE"), "Probable recall/investigation is missing");
  for (const recall of recalls) {
    check(recall.affectedBatches.length > 0, `Recall ${recall.code} has no affected batch`);
    for (const action of recall.quarantineActions) {
      const position = await prisma.stockPosition.findFirst({ where: { batchId: action.batchId, locationId: action.locationId, stockStatus: "QUARANTINED" } });
      check((position?.quantityBaseUnits ?? 0) >= action.quantityBaseUnits, `Quarantine ${action.code} disagrees with its stock position`);
    }
  }
  const priorIssue = await prisma.inventoryTransaction.findFirst({ where: { referenceType: "DISPENSING_HISTORY" }, include: { entries: true } });
  check(priorIssue !== null && priorIssue.entries.some((entry) => entry.quantityBaseUnits < 0), "Prior issue history for recall exposure is missing");
}

async function validateWorkflowsAndAssets(): Promise<void> {
  const actions = await prisma.preparedAction.findMany({ include: { approvalRequests: { include: { decisions: true } }, executions: true } });
  for (const action of actions) {
    const approved = action.approvalRequests.some((request) => request.status === "APPROVED" && request.decisions.some((decision) => decision.decision === "APPROVED"));
    if (action.executions.length > 0) check(approved, `Action ${action.code} executed without a satisfied approval`);
    if (!approved) check(action.executions.length === 0, `Unapproved action ${action.code} has an execution`);
  }
  check(actions.some((action) => action.status === "EXECUTED" && action.executions.some((execution) => execution.status === "SUCCEEDED")), "Approved and executed action example is missing");
  check(actions.some((action) => action.status === "PENDING_APPROVAL" && action.executions.length === 0), "Pending approval example is missing");
  check(actions.some((action) => action.status === "REJECTED" && action.executions.length === 0), "Rejected action example is missing");
  check(actions.some((action) => action.executions.some((execution) => execution.status === "FAILED")), "Failed execution example is missing");
  const requesterTypes = new Set(actions.map((action) => action.requesterType));
  check(
    ["USER", "AGENT", "SYSTEM"].every((requesterType) => requesterTypes.has(requesterType)),
    "Prepared actions do not demonstrate USER, AGENT, and SYSTEM requesters",
  );
  const purchaseOrders = await prisma.purchaseOrder.findMany();
  for (const purchaseOrder of purchaseOrders) {
    const supportingExecution = actions.some((action) => action.executions.some((execution) => execution.status === "SUCCEEDED" && execution.resultType === "PURCHASE_ORDER" && execution.resultId === purchaseOrder.id));
    check(supportingExecution, `Purchase order ${purchaseOrder.code} lacks a successful, approved workflow execution`);
  }

  const assets = await prisma.asset.findMany({ include: { allocations: { where: { status: "ACTIVE" } }, maintenance: true } });
  check(assets.some((asset) => asset.status === "AVAILABLE" && asset.allocations.length === 0), "Available/idle asset is missing");
  check(assets.filter((asset) => asset.status === "IN_USE").every((asset) => asset.allocations.length === 1), "An in-use asset lacks one active allocation");
  check(assets.some((asset) => asset.status === "MAINTENANCE_OVERDUE" && asset.nextMaintenanceAt !== null && asset.nextMaintenanceAt < at(0)), "Overdue-maintenance asset is missing");
  check(assets.some((asset) => asset.status === "QUARANTINED" || asset.status === "UNAVAILABLE"), "Unavailable/quarantined asset is missing");
}

async function validateOperationalLogistics(): Promise<void> {
  const transfers = await prisma.transferLine.findMany({ where: { requirementId: "requirement-icu-001" } });
  check(sum(transfers.map((line) => line.quantityBaseUnits)) === 70, "Prepared transfer lines do not reconcile to 70 units");

  const linen = await prisma.stockPosition.findMany({ where: { batchId: "batch-linen-flow", quantityBaseUnits: { gt: 0 } } });
  const linenByStatus = new Map(linen.map((position) => [position.stockStatus, position.quantityBaseUnits]));
  check(linenByStatus.get("CLEAN") === 120, "Linen clean balance should be 120");
  check(linenByStatus.get("ISSUED") === 10, "Linen issued balance should be 10");
  check(linenByStatus.get("LAUNDERING") === 65, "Linen laundering balance should be 65");
  check(linenByStatus.get("REJECTED_LOST") === 5, "Linen rejected/lost balance should be 5");
  check(sum(linen.map((position) => position.quantityBaseUnits)) === 200, "Linen cycle does not conserve its 200-piece opening quantity");

  const oxygen = await prisma.stockPosition.findMany({ where: { batchId: "batch-oxygen-flow", quantityBaseUnits: { gt: 0 } } });
  const oxygenByStatus = new Map(oxygen.map((position) => [position.stockStatus, position.quantityBaseUnits]));
  check(oxygenByStatus.get("FULL_AVAILABLE") === 28, "Medical-gas store should have 28 full available cylinders");
  check(oxygenByStatus.get("ALLOCATED_FULL") === 7, "ICU should have 7 allocated full cylinders");
  check(oxygenByStatus.get("EMPTY_RETURNED") === 5, "Medical-gas store should have 5 returned empties");
  check(oxygenByStatus.get("SAFETY_HOLD") === 2, "Medical-gas safety hold should contain 2 cylinders");
  check(sum(oxygen.map((position) => position.quantityBaseUnits)) === 42, "Medical oxygen cylinder cycle does not conserve 42 cylinders");
}

async function validateScopeExclusions(): Promise<void> {
  const schema = await readFile("prisma/schema.prisma", "utf8");
  check(!/^model\s+(Forecast|Prediction|Diagnosis|TreatmentRecommendation|Patient|PatientRecord)\b/m.test(schema), "Forbidden predictive, patient, or clinical-decision model found in schema");
  const forbiddenRecords = await prisma.workflowRun.count({ where: { OR: [{ workflowType: { contains: "FORECAST" } }, { workflowType: { contains: "PREDICT" } }, { workflowType: { contains: "DIAGNOS" } }] } });
  check(forbiddenRecords === 0, "Forbidden predictive or diagnostic workflow record found");
}

function workforceLocalDay(date: Date): number {
  return Math.floor((date.getTime() + 330 * 60_000) / 86_400_000);
}

function longestWorkforceRun(shifts: readonly { startsAt: Date }[]): number {
  const days = [...new Set(shifts.map((shift) => workforceLocalDay(shift.startsAt)))].sort((left, right) => left - right);
  let longest = 0;
  let current = 0;
  let previous: number | null = null;
  for (const day of days) {
    current = previous !== null && day === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

async function validateWorkforce(): Promise<Record<string, number>> {
  const publishedWeekStart = new Date("2026-07-06T00:00:00+05:30");
  const planningWeekStart = new Date("2026-07-13T00:00:00+05:30");
  const [profiles, nurses, qualifiedNurses, shifts, publishedShifts, planningShifts, publishedAssignments, planningAssignments] = await Promise.all([
    prisma.staffProfile.count(),
    prisma.staffProfile.count({ where: { staffType: "REGISTERED_NURSE" } }),
    prisma.staffProfile.count({
      where: {
        staffType: "REGISTERED_NURSE",
        active: true,
        employmentStatus: "ACTIVE",
        skills: {
          some: {
            skillCode: "ICU_CRITICAL_CARE",
            active: true,
            validFrom: { lte: publishedWeekStart },
            OR: [{ validUntil: null }, { validUntil: { gte: new Date("2026-07-20T07:00:00+05:30") } }],
          },
        },
      },
    }),
    prisma.shift.count(),
    prisma.shift.count({ where: { rosterWeekStart: publishedWeekStart, status: "PUBLISHED" } }),
    prisma.shift.count({ where: { rosterWeekStart: planningWeekStart, status: "OPEN" } }),
    prisma.shiftAssignment.count({ where: { shift: { rosterWeekStart: publishedWeekStart } } }),
    prisma.shiftAssignment.count({ where: { shift: { rosterWeekStart: planningWeekStart } } }),
  ]);
  check(profiles === 15, `Expected 15 staff profiles, found ${profiles}`);
  check(nurses === 9, `Expected 9 registered nurses, found ${nurses}`);
  check(qualifiedNurses === 8, `Expected 8 ICU-qualified nurses, found ${qualifiedNurses}`);
  check(shifts === 42, `Expected 42 workforce shifts, found ${shifts}`);
  check(publishedShifts === 21, `Expected 21 published-week shifts, found ${publishedShifts}`);
  check(planningShifts === 21, `Expected 21 planning-week shifts, found ${planningShifts}`);
  check(publishedAssignments === 44, `Expected 44 published assignment slots, found ${publishedAssignments}`);
  check(planningAssignments === 0, `Planning week must have zero persisted assignments, found ${planningAssignments}`);

  const expectedRoles = [
    "CLINICAL_STAFF", "CLINICAL_STAFF", "CLINICAL_STAFF", "CLINICAL_STAFF", "CLINICAL_STAFF",
    "CLINICAL_STAFF", "CLINICAL_STAFF", "CLINICAL_STAFF", "CLINICAL_STAFF", "FINANCE_APPROVER",
    "COMPLIANCE_OFFICER", "OPERATIONS_ADMIN", "INVENTORY_OFFICER", "PHARMACY_MANAGER", "PROCUREMENT_OFFICER",
  ] as const;
  const expectedNames = [
    "Asha Nair", "Meera Kulkarni", "Kavya Rao", "Neha Iyer", "Riya Menon",
    "Ananya Shah", "Priya Deshmukh", "Saanvi Joshi", "Diya Kapoor", "Arjun Malhotra",
    "Nandita Bose", "Vikram Shetty", "Rahul Patil", "Isha Banerjee", "Karan Mehta",
  ] as const;
  const users = await prisma.user.findMany({ where: { organizationId: ORGANIZATION_ID }, include: { assignments: { include: { role: true } } }, orderBy: { employeeCode: "asc" } });
  users.forEach((user, index) => {
    check(user.displayName === expectedNames[index], `${user.id} does not have the expected synthetic display name`);
    check(user.assignments.length === 1 && user.assignments[0]?.role.code === expectedRoles[index], `${user.id} does not have the expected authorization role`);
  });

  const targetShiftId = "shift-icu-20260709-day";
  const coverage = await getShiftCoverage(prisma, ORGANIZATION_ID, targetShiftId);
  check(coverage.activeAssignmentCount === 3 && coverage.requiredHeadcount === 4, `Target shift coverage should be 3/4, found ${coverage.activeAssignmentCount}/${coverage.requiredHeadcount}`);
  check(coverage.absentAssignmentCount === 1, `Target shift should preserve one absent assignment, found ${coverage.absentAssignmentCount}`);
  const candidates = await evaluateReplacementCandidates(prisma, ORGANIZATION_ID, targetShiftId);
  const candidate = (userId: string) => candidates.find((item) => item.userId === userId);
  const user05 = candidate("user-05");
  const user06 = candidate("user-06");
  const user07 = candidate("user-07");
  const user08 = candidate("user-08");
  const user09 = candidate("user-09");
  check(candidates.filter((item) => item.eligible).length === 1, `Expected one eligible replacement, found ${candidates.filter((item) => item.eligible).length}`);
  check(user05?.eligible === true && user05.recommended && user05.deterministicRank === 1, "User 05 is not the sole deterministic recommendation");
  check(user05?.scheduledMinutes === 1_920 && user05.resultingMinutes === 2_400, `User 05 workload should move 1,920→2,400 minutes, found ${user05?.scheduledMinutes ?? -1}→${user05?.resultingMinutes ?? -1}`);
  check(user06?.exclusionReasonCodes.includes("MAX_WEEKLY_MINUTES") === true, "User 06 is not excluded for maximum weekly minutes");
  check(user07?.exclusionReasonCodes.includes("APPROVED_UNAVAILABILITY") === true, "User 07 is not excluded for approved unavailability");
  check(user08?.exclusionReasonCodes.includes("MISSING_REQUIRED_SKILL") === true, "User 08 is not excluded for missing ICU skill");
  check(user09?.exclusionReasonCodes.includes("MINIMUM_REST") === true, "User 09 is not excluded for minimum rest");
  check(coverage.activeAssignmentCount + (user05?.eligible ? 1 : 0) === 4, "Recommended replacement would not produce 4/4 coverage");

  const confirmedProfiles = await prisma.staffProfile.findMany({
    include: {
      skills: true,
      assignments: {
        where: { status: { in: ["DRAFT", "CONFIRMED"] } },
        include: { shift: true },
        orderBy: { shift: { startsAt: "asc" } },
      },
    },
  });
  for (const profile of confirmedProfiles) {
    const byWeek = new Map<number, typeof profile.assignments>();
    for (const assignment of profile.assignments) {
      const key = assignment.shift.rosterWeekStart.getTime();
      byWeek.set(key, [...(byWeek.get(key) ?? []), assignment]);
    }
    for (const assignments of byWeek.values()) {
      const ordered = [...assignments].sort((left, right) => left.shift.startsAt.getTime() - right.shift.startsAt.getTime());
      const minutes = ordered.reduce((total, assignment) => total + Math.round((assignment.shift.endsAt.getTime() - assignment.shift.startsAt.getTime()) / 60_000), 0);
      check(minutes <= profile.maxMinutesPerWeek, `${profile.id} exceeds weekly maximum with ${minutes} minutes`);
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1].shift;
        const current = ordered[index].shift;
        check(previous.startsAt < current.endsAt && previous.endsAt > current.startsAt ? false : true, `${profile.id} has overlapping confirmed assignments`);
        const rest = Math.round((current.startsAt.getTime() - previous.endsAt.getTime()) / 60_000);
        check(rest >= profile.minRestMinutes, `${profile.id} has only ${rest} rest minutes between confirmed assignments`);
      }
      check(longestWorkforceRun(ordered.map((assignment) => assignment.shift)) <= profile.maxConsecutiveShifts, `${profile.id} exceeds consecutive-shift limit`);
      check(longestWorkforceRun(ordered.filter((assignment) => assignment.shift.shiftType === "NIGHT").map((assignment) => assignment.shift)) <= profile.maxConsecutiveNightShifts, `${profile.id} exceeds consecutive-night limit`);
      for (const assignment of ordered) {
        const validSkill = profile.skills.some(
          (skill) => skill.skillCode === assignment.shift.requiredSkillCode && skill.active && skill.validFrom <= assignment.shift.startsAt && (skill.validUntil === null || skill.validUntil >= assignment.shift.endsAt),
        );
        check(validSkill, `${profile.id} lacks a valid skill for confirmed assignment ${assignment.code}`);
      }
    }
  }

  const plan = await buildWeeklyRosterPlan(prisma, ORGANIZATION_ID, LOCATION_IDS.icu, planningWeekStart);
  check(plan.requiredSlots === 42 && plan.proposedAssignments.length === 42, `Planning builder should produce 42 assignments, found ${plan.proposedAssignments.length}`);
  const plannedCounts = Object.values(plan.distribution).sort((left, right) => left - right);
  check(plannedCounts.filter((count) => count === 6).length === 2, "Planning distribution does not contain exactly two six-shift nurses");
  check(plannedCounts.filter((count) => count === 5).length === 6, "Planning distribution does not contain exactly six five-shift nurses");
  const planByProfile = new Map<string, typeof plan.proposedAssignments>();
  for (const assignment of plan.proposedAssignments) {
    planByProfile.set(assignment.staffProfileId, [...(planByProfile.get(assignment.staffProfileId) ?? []), assignment]);
  }
  for (const [profileId, assignments] of planByProfile) {
    const profile = confirmedProfiles.find((item) => item.id === profileId);
    check(profile !== undefined, `Planned profile ${profileId} does not exist`);
    if (profile === undefined) continue;
    const ordered = [...assignments].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
    const minutes = sum(ordered.map((assignment) => assignment.durationMinutes));
    check(minutes <= profile.maxMinutesPerWeek, `Planned profile ${profileId} exceeds weekly minutes`);
    for (let index = 1; index < ordered.length; index += 1) {
      check(ordered[index - 1].endsAt <= ordered[index].startsAt, `Planned profile ${profileId} has overlapping shifts`);
      const rest = Math.round((ordered[index].startsAt.getTime() - ordered[index - 1].endsAt.getTime()) / 60_000);
      check(rest >= profile.minRestMinutes, `Planned profile ${profileId} violates minimum rest with ${rest} minutes`);
    }
    check(longestWorkforceRun(ordered) <= profile.maxConsecutiveShifts, `Planned profile ${profileId} exceeds consecutive shifts`);
    check(longestWorkforceRun(ordered.filter((assignment) => assignment.shiftType === "NIGHT")) <= profile.maxConsecutiveNightShifts, `Planned profile ${profileId} exceeds consecutive nights`);
    for (const assignment of ordered) {
      const validSkill = profile.skills.some(
        (skill) => skill.skillCode === "ICU_CRITICAL_CARE" && skill.active && skill.validFrom <= assignment.startsAt && (skill.validUntil === null || skill.validUntil >= assignment.endsAt),
      );
      check(validSkill, `Planned profile ${profileId} lacks ICU skill validity through ${assignment.shiftCode}`);
    }
  }

  const notifications = await prisma.notificationDelivery.findMany();
  check(notifications.length > 0, "Workforce notification-delivery example is missing");
  check(new Set(notifications.map((notification) => notification.idempotencyKey)).size === notifications.length, "Notification idempotency keys are not unique");
  check(notifications.every((notification) => notification.recipientMasked.includes("***") && /^[a-f0-9]{64}$/.test(notification.recipientHash)), "Notification recipient masking or hashing is unsafe");

  return {
    profiles,
    nurses,
    qualifiedNurses,
    shifts,
    publishedAssignments,
    targetActiveCoverage: coverage.activeAssignmentCount,
    targetRequiredCoverage: coverage.requiredHeadcount,
    planningAssignments: plan.proposedAssignments.length,
    notifications: notifications.length,
  };
}

async function main(): Promise<void> {
  const counts = await validateCounts();
  await validateUniqueness();
  await validateLedger();
  const icu = await validateIcuScenario();
  const receiving = await validateProcurementAndReceiving();
  await validateRecalls();
  await validateWorkflowsAndAssets();
  await validateOperationalLogistics();
  const workforce = await validateWorkforce();
  await validateScopeExclusions();

  if (failures.length > 0) {
    throw new Error(`CareFlow validation failed:\n- ${failures.join("\n- ")}`);
  }
  console.log(JSON.stringify({ valid: true, counts, scenarios: { icuRedistribution: icu, receivingDiscrepancy: receiving, workforce } }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
