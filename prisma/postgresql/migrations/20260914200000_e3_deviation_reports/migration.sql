-- CreateTable
CREATE TABLE "DeviationReport" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviationReport_createdBy_updatedAt_idx" ON "DeviationReport"("createdBy", "updatedAt");

