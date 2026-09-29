-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "actualsClosedAt" TIMESTAMP(3),
ADD COLUMN     "competitor" TEXT,
ADD COLUMN     "contractAmount" DOUBLE PRECISION,
ADD COLUMN     "contractCurrency" TEXT,
ADD COLUMN     "dealClosedAt" TIMESTAMP(3),
ADD COLUMN     "dealClosedBy" TEXT,
ADD COLUMN     "dealStatus" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "lossComment" TEXT,
ADD COLUMN     "lossReason" TEXT,
ADD COLUMN     "wonCalculationId" TEXT;

-- AlterTable
ALTER TABLE "Calculation" ADD COLUMN     "actualPmHours" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "actualEndDate" TIMESTAMP(3),
ADD COLUMN     "actualHours" DOUBLE PRECISION,
ADD COLUMN     "actualNote" TEXT,
ADD COLUMN     "actualStartDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Project_dealStatus_dealClosedAt_idx" ON "Project"("dealStatus", "dealClosedAt");

