-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationType" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "approvalLimitPaise" INTEGER NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "locationId" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "homeLocationId" TEXT NOT NULL,
    "staffType" TEXT NOT NULL,
    "employmentStatus" TEXT NOT NULL,
    "contractMinutesPerWeek" INTEGER NOT NULL,
    "maxMinutesPerWeek" INTEGER NOT NULL,
    "minRestMinutes" INTEGER NOT NULL,
    "maxConsecutiveShifts" INTEGER NOT NULL,
    "maxConsecutiveNightShifts" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSkill" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "skillCode" TEXT NOT NULL,
    "proficiencyLevel" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "rosterWeekStart" TIMESTAMP(3) NOT NULL,
    "shiftType" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "requiredStaffType" TEXT NOT NULL,
    "requiredSkillCode" TEXT NOT NULL,
    "requiredHeadcount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "preparedActionId" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL,
    "assignedByType" TEXT NOT NULL,
    "assignedById" TEXT,
    "notes" TEXT NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUnavailability" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "unavailabilityType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "trackingMode" TEXT NOT NULL,
    "storageRequirement" TEXT NOT NULL,
    "coldChainMinCentiCelsius" INTEGER,
    "coldChainMaxCentiCelsius" INTEGER,
    "shelfLifeDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationItemPolicy" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "parLevelBaseUnits" INTEGER NOT NULL,
    "safetyStockBaseUnits" INTEGER NOT NULL,
    "reorderThresholdBaseUnits" INTEGER NOT NULL,
    "transferEligible" BOOLEAN NOT NULL,
    "minimumRemainingShelfLifeDays" INTEGER NOT NULL,

    CONSTRAINT "LocationItemPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxIdentifier" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "complianceStatus" TEXT NOT NULL,
    "performanceScoreBasisPoints" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "portalTokenHash" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItem" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierSku" TEXT NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "gstBasisPoints" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "minimumOrderBaseUnits" INTEGER NOT NULL,
    "availableBaseUnits" INTEGER NOT NULL,
    "compliant" BOOLEAN NOT NULL,

    CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBatch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "manufacturerName" TEXT NOT NULL,
    "manufacturedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "serialNumber" TEXT,
    "coldChainEvidenceStatus" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdByType" TEXT NOT NULL,
    "createdById" TEXT,
    "metadataJson" TEXT NOT NULL,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "batchId" TEXT,
    "stockStatus" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "reservationKey" TEXT NOT NULL,
    "positionKey" TEXT NOT NULL,
    "quantityBaseUnits" INTEGER NOT NULL,
    "unitCostPaise" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPosition" (
    "id" TEXT NOT NULL,
    "positionKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "batchId" TEXT,
    "stockStatus" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "reservationKey" TEXT NOT NULL,
    "quantityBaseUnits" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requiredBaseUnits" INTEGER NOT NULL,
    "fulfilledLocallyBaseUnits" INTEGER NOT NULL,
    "fulfilledByTransferBaseUnits" INTEGER NOT NULL,
    "procurementGapBaseUnits" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "neededBy" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requirementId" TEXT,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "batchId" TEXT,
    "quantityBaseUnits" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "requirementId" TEXT,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT,
    "quantityBaseUnits" INTEGER NOT NULL,

    CONSTRAINT "TransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementNeed" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "quantityBaseUnits" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqLine" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "procurementNeedId" TEXT NOT NULL,
    "requestedBaseUnits" INTEGER NOT NULL,

    CONSTRAINT "RfqLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "complianceStatus" TEXT NOT NULL,
    "performanceScoreBasisPoints" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "comparisonRank" INTEGER NOT NULL,
    "tradeoffSummary" TEXT NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "rfqLineId" TEXT NOT NULL,
    "offeredBaseUnits" INTEGER NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "gstBasisPoints" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "availableBaseUnits" INTEGER NOT NULL,
    "compliant" BOOLEAN NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteId" TEXT,
    "status" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "expectedAt" TIMESTAMP(3) NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "orderedBaseUnits" INTEGER NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "gstBasisPoints" INTEGER NOT NULL,
    "lineSubtotalPaise" INTEGER NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "deliveryNote" TEXT NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "orderedBaseUnits" INTEGER NOT NULL,
    "receivedBaseUnits" INTEGER NOT NULL,
    "acceptedBaseUnits" INTEGER NOT NULL,
    "rejectedBaseUnits" INTEGER NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivingDiscrepancy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "goodsReceiptLineId" TEXT NOT NULL,
    "discrepancyType" TEXT NOT NULL,
    "quantityBaseUnits" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "ReceivingDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallNotice" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "investigationNotes" TEXT NOT NULL,

    CONSTRAINT "RecallNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallBatch" (
    "id" TEXT NOT NULL,
    "recallNoticeId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "affected" BOOLEAN NOT NULL,
    "priorIssuedBaseUnits" INTEGER NOT NULL,

    CONSTRAINT "RecallBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuarantineAction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "recallNoticeId" TEXT,
    "batchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantityBaseUnits" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quarantinedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuarantineAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuarantineRelease" (
    "id" TEXT NOT NULL,
    "quarantineActionId" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "quantityBaseUnits" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "QuarantineRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "itemId" TEXT,
    "locationId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "manufacturerName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "commissionedAt" TIMESTAMP(3) NOT NULL,
    "nextMaintenanceAt" TIMESTAMP(3),

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAllocation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "allocatedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "purpose" TEXT NOT NULL,

    CONSTRAINT "AssetAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "maintenanceType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "minimumAmountPaise" INTEGER NOT NULL,
    "maximumAmountPaise" INTEGER,
    "requiredRoleCode" TEXT NOT NULL,
    "requiredApprovals" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workflowType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparedAction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "requesterType" TEXT NOT NULL,
    "requesterId" TEXT,
    "status" TEXT NOT NULL,
    "amountPaise" INTEGER,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "reasoningSummary" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreparedAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "preparedActionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipientMasked" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "preparedActionId" TEXT NOT NULL,
    "approvalPolicyId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionExecution" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "preparedActionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "resultType" TEXT,
    "resultId" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "ActionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detailsJson" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserAssignment_userId_roleId_locationId_key" ON "UserAssignment"("userId", "roleId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");

-- CreateIndex
CREATE INDEX "StaffProfile_staffType_employmentStatus_active_idx" ON "StaffProfile"("staffType", "employmentStatus", "active");

-- CreateIndex
CREATE INDEX "StaffSkill_skillCode_active_validUntil_idx" ON "StaffSkill"("skillCode", "active", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSkill_staffProfileId_skillCode_key" ON "StaffSkill"("staffProfileId", "skillCode");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_code_key" ON "Shift"("code");

-- CreateIndex
CREATE INDEX "Shift_rosterWeekStart_locationId_status_idx" ON "Shift"("rosterWeekStart", "locationId", "status");

-- CreateIndex
CREATE INDEX "Shift_startsAt_endsAt_idx" ON "Shift"("startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_locationId_startsAt_requiredStaffType_requiredSkillCo_key" ON "Shift"("locationId", "startsAt", "requiredStaffType", "requiredSkillCode");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_code_key" ON "ShiftAssignment"("code");

-- CreateIndex
CREATE INDEX "ShiftAssignment_staffProfileId_status_idx" ON "ShiftAssignment"("staffProfileId", "status");

-- CreateIndex
CREATE INDEX "ShiftAssignment_shiftId_status_idx" ON "ShiftAssignment"("shiftId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_shiftId_staffProfileId_key" ON "ShiftAssignment"("shiftId", "staffProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUnavailability_code_key" ON "StaffUnavailability"("code");

-- CreateIndex
CREATE INDEX "StaffUnavailability_staffProfileId_startsAt_endsAt_status_idx" ON "StaffUnavailability"("staffProfileId", "startsAt", "endsAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_code_key" ON "ItemCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_sku_key" ON "CatalogItem"("sku");

-- CreateIndex
CREATE INDEX "CatalogItem_categoryId_idx" ON "CatalogItem"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationItemPolicy_locationId_itemId_key" ON "LocationItemPolicy"("locationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_taxIdentifier_key" ON "Supplier"("taxIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierContact_portalTokenHash_key" ON "SupplierContact"("portalTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierContact_supplierId_email_key" ON "SupplierContact"("supplierId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItem_supplierId_itemId_key" ON "SupplierItem"("supplierId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBatch_serialNumber_key" ON "StockBatch"("serialNumber");

-- CreateIndex
CREATE INDEX "StockBatch_itemId_expiresAt_idx" ON "StockBatch"("itemId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockBatch_itemId_batchNumber_key" ON "StockBatch"("itemId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_code_key" ON "InventoryTransaction"("code");

-- CreateIndex
CREATE INDEX "InventoryTransaction_referenceType_referenceId_idx" ON "InventoryTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_positionKey_idx" ON "InventoryLedgerEntry"("positionKey");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_itemId_locationId_stockStatus_idx" ON "InventoryLedgerEntry"("itemId", "locationId", "stockStatus");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedgerEntry_transactionId_sequence_key" ON "InventoryLedgerEntry"("transactionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "StockPosition_positionKey_key" ON "StockPosition"("positionKey");

-- CreateIndex
CREATE INDEX "StockPosition_itemId_locationId_stockStatus_idx" ON "StockPosition"("itemId", "locationId", "stockStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_code_key" ON "Requirement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_code_key" ON "Reservation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_code_key" ON "Transfer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementNeed_code_key" ON "ProcurementNeed"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_code_key" ON "Rfq"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RfqLine_rfqId_lineNumber_key" ON "RfqLine"("rfqId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_code_key" ON "Quote"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_rfqId_supplierId_key" ON "Quote"("rfqId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_rfqLineId_key" ON "QuoteLine"("quoteId", "rfqLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_lineNumber_key" ON "PurchaseOrderLine"("purchaseOrderId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_code_key" ON "GoodsReceipt"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivingDiscrepancy_code_key" ON "ReceivingDiscrepancy"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RecallNotice_code_key" ON "RecallNotice"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RecallBatch_recallNoticeId_batchId_key" ON "RecallBatch"("recallNoticeId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "QuarantineAction_code_key" ON "QuarantineAction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_serialNumber_key" ON "Asset"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_code_key" ON "ApprovalPolicy"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_code_key" ON "WorkflowRun"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_correlationId_key" ON "WorkflowRun"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparedAction_code_key" ON "PreparedAction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_code_key" ON "NotificationDelivery"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_idempotencyKey_key" ON "NotificationDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_requestedAt_idx" ON "NotificationDelivery"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_preparedActionId_channel_key" ON "NotificationDelivery"("preparedActionId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_code_key" ON "ApprovalRequest"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_approvalRequestId_approverUserId_key" ON "ApprovalDecision"("approvalRequestId", "approverUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionExecution_code_key" ON "ActionExecution"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_sequence_key" ON "AuditEvent"("sequence");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_idx" ON "AuditEvent"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSkill" ADD CONSTRAINT "StaffSkill_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_preparedActionId_fkey" FOREIGN KEY ("preparedActionId") REFERENCES "PreparedAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUnavailability" ADD CONSTRAINT "StaffUnavailability_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUnavailability" ADD CONSTRAINT "StaffUnavailability_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationItemPolicy" ADD CONSTRAINT "LocationItemPolicy_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationItemPolicy" ADD CONSTRAINT "LocationItemPolicy_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPosition" ADD CONSTRAINT "StockPosition_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPosition" ADD CONSTRAINT "StockPosition_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPosition" ADD CONSTRAINT "StockPosition_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementNeed" ADD CONSTRAINT "ProcurementNeed_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_procurementNeedId_fkey" FOREIGN KEY ("procurementNeedId") REFERENCES "ProcurementNeed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_rfqLineId_fkey" FOREIGN KEY ("rfqLineId") REFERENCES "RfqLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingDiscrepancy" ADD CONSTRAINT "ReceivingDiscrepancy_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingDiscrepancy" ADD CONSTRAINT "ReceivingDiscrepancy_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallBatch" ADD CONSTRAINT "RecallBatch_recallNoticeId_fkey" FOREIGN KEY ("recallNoticeId") REFERENCES "RecallNotice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallBatch" ADD CONSTRAINT "RecallBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantineAction" ADD CONSTRAINT "QuarantineAction_recallNoticeId_fkey" FOREIGN KEY ("recallNoticeId") REFERENCES "RecallNotice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantineAction" ADD CONSTRAINT "QuarantineAction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantineAction" ADD CONSTRAINT "QuarantineAction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantineRelease" ADD CONSTRAINT "QuarantineRelease_quarantineActionId_fkey" FOREIGN KEY ("quarantineActionId") REFERENCES "QuarantineAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAllocation" ADD CONSTRAINT "AssetAllocation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAllocation" ADD CONSTRAINT "AssetAllocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAllocation" ADD CONSTRAINT "AssetAllocation_allocatedByUserId_fkey" FOREIGN KEY ("allocatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedAction" ADD CONSTRAINT "PreparedAction_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_preparedActionId_fkey" FOREIGN KEY ("preparedActionId") REFERENCES "PreparedAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_preparedActionId_fkey" FOREIGN KEY ("preparedActionId") REFERENCES "PreparedAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approvalPolicyId_fkey" FOREIGN KEY ("approvalPolicyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionExecution" ADD CONSTRAINT "ActionExecution_preparedActionId_fkey" FOREIGN KEY ("preparedActionId") REFERENCES "PreparedAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
