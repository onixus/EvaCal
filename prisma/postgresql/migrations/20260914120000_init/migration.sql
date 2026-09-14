-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessAgent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "endpoint" TEXT NOT NULL,
    "authToken" TEXT,
    "modes" TEXT NOT NULL DEFAULT '["review"]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "defaultStartDate" TIMESTAMP(3),
    "workDayHours" INTEGER NOT NULL DEFAULT 6,
    "includeWeekends" BOOLEAN NOT NULL DEFAULT false,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'RUB',
    "defaultRoleRates" TEXT,
    "defaultMarginPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "baseHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "driverFieldKey" TEXT,
    "requirements" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RiskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "customer" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL DEFAULT 'presale',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calculation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "answers" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pmHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL DEFAULT 'presale',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "standardProfileId" TEXT,
    "standardProfileVersion" TEXT,
    "generatorVersion" TEXT,
    "generatedAt" TIMESTAMP(3),
    "projectId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentCalculationId" TEXT,
    "versionComment" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "roleRates" TEXT,
    "overheadPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "includeVat" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Calculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GostPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "projectId" TEXT,
    "calculationId" TEXT NOT NULL,
    "standardProfileId" TEXT NOT NULL,
    "standardProfileVersion" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "documentTypes" TEXT NOT NULL,
    "metadata" TEXT,
    "snapshot" TEXT,
    "artifactPath" TEXT,
    "checksum" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "reviewComment" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "reviewStage" TEXT NOT NULL DEFAULT 'tw',
    "reviewChecklist" TEXT,
    "reviewComments" TEXT,
    "twVersionPath" TEXT,
    "twVersionName" TEXT,
    "twVersionUploadedAt" TIMESTAMP(3),
    "twVersionUploadedBy" TEXT,
    "twVersionIsPriority" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL DEFAULT 'architect',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GostPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isApprovalTask" BOOLEAN NOT NULL DEFAULT false,
    "approvalForStageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "dueDate" TIMESTAMP(3),
    "requirements" TEXT,
    "parallel" BOOLEAN NOT NULL DEFAULT false,
    "approvalDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "meta" TEXT,
    "ip" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalChange" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "docRef" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "packageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "HarnessAgent_ownerId_idx" ON "HarnessAgent"("ownerId");

-- CreateIndex
CREATE INDEX "FormTemplate_isActive_idx" ON "FormTemplate"("isActive");

-- CreateIndex
CREATE INDEX "FormTemplate_createdAt_id_idx" ON "FormTemplate"("createdAt", "id");

-- CreateIndex
CREATE INDEX "FormField_templateId_order_idx" ON "FormField"("templateId", "order");

-- CreateIndex
CREATE INDEX "StageTemplate_templateId_order_idx" ON "StageTemplate"("templateId", "order");

-- CreateIndex
CREATE INDEX "RiskTemplate_templateId_order_idx" ON "RiskTemplate"("templateId", "order");

-- CreateIndex
CREATE INDEX "Project_createdAt_id_idx" ON "Project"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Project_customer_status_idx" ON "Project"("customer", "status");

-- CreateIndex
CREATE INDEX "Calculation_createdAt_id_idx" ON "Calculation"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Calculation_templateId_idx" ON "Calculation"("templateId");

-- CreateIndex
CREATE INDEX "Calculation_status_createdAt_id_idx" ON "Calculation"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Calculation_projectId_version_idx" ON "Calculation"("projectId", "version");

-- CreateIndex
CREATE INDEX "GostPackage_projectId_version_idx" ON "GostPackage"("projectId", "version");

-- CreateIndex
CREATE INDEX "GostPackage_calculationId_idx" ON "GostPackage"("calculationId");

-- CreateIndex
CREATE INDEX "GostPackage_status_createdAt_idx" ON "GostPackage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Stage_calculationId_order_idx" ON "Stage"("calculationId", "order");

-- CreateIndex
CREATE INDEX "Risk_calculationId_order_idx" ON "Risk"("calculationId", "order");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_at_idx" ON "AuditEvent"("action", "at");

-- CreateIndex
CREATE INDEX "InternalChange_calculationId_occurredAt_idx" ON "InternalChange"("calculationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InternalChange_calculationId_seq_key" ON "InternalChange"("calculationId", "seq");

-- AddForeignKey
ALTER TABLE "HarnessAgent" ADD CONSTRAINT "HarnessAgent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageTemplate" ADD CONSTRAINT "StageTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskTemplate" ADD CONSTRAINT "RiskTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_parentCalculationId_fkey" FOREIGN KEY ("parentCalculationId") REFERENCES "Calculation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GostPackage" ADD CONSTRAINT "GostPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GostPackage" ADD CONSTRAINT "GostPackage_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalChange" ADD CONSTRAINT "InternalChange_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

