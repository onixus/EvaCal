-- CreateTable
CREATE TABLE "RoleCapacity" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "headcount" DOUBLE PRECISION NOT NULL,
    "hoursPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleCapacity_role_effectiveFrom_idx" ON "RoleCapacity"("role", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Stage_startDate_idx" ON "Stage"("startDate");

