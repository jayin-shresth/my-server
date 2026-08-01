-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StaffProfile_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StaffSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffProfileId" TEXT NOT NULL,
    "skillCode" TEXT NOT NULL,
    "proficiencyLevel" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "StaffSkill_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "rosterWeekStart" DATETIME NOT NULL,
    "shiftType" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "requiredStaffType" TEXT NOT NULL,
    "requiredSkillCode" TEXT NOT NULL,
    "requiredHeadcount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "preparedActionId" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL,
    "assignedByType" TEXT NOT NULL,
    "assignedById" TEXT,
    "notes" TEXT NOT NULL,
    CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShiftAssignment_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShiftAssignment_preparedActionId_fkey" FOREIGN KEY ("preparedActionId") REFERENCES "PreparedAction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StaffUnavailability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "unavailabilityType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffUnavailability_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StaffUnavailability_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "requestedAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "failedAt" DATETIME,
    "lastError" TEXT,
    CONSTRAINT "NotificationDelivery_preparedActionId_fkey" FOREIGN KEY ("preparedActionId") REFERENCES "PreparedAction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
CREATE UNIQUE INDEX "Shift_locationId_startsAt_requiredStaffType_requiredSkillCode_key" ON "Shift"("locationId", "startsAt", "requiredStaffType", "requiredSkillCode");

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
CREATE UNIQUE INDEX "NotificationDelivery_code_key" ON "NotificationDelivery"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_idempotencyKey_key" ON "NotificationDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_requestedAt_idx" ON "NotificationDelivery"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_preparedActionId_channel_key" ON "NotificationDelivery"("preparedActionId", "channel");
