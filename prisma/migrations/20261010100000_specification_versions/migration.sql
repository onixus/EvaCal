CREATE TABLE "SpecificationVersion" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "data" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecificationVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SpecificationVersion_status_check" CHECK ("status" IN ('draft', 'confirmed')),
    CONSTRAINT "SpecificationVersion_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "SpecificationVersion_calculationId_version_key" ON "SpecificationVersion"("calculationId", "version");
ALTER TABLE "SpecificationVersion" ADD CONSTRAINT "SpecificationVersion_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
