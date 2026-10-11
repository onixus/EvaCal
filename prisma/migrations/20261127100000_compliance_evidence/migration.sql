-- #101 stage 3: registry entries and certificates of catalog products.
-- Display status is derived in the application (expiry, stale checks); the stored
-- status is the result of the manual check. Archived rows keep history.
CREATE TABLE "ComplianceEvidence" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "productId" TEXT NOT NULL,
 "productRevision" INTEGER,
 "type" TEXT NOT NULL,
 "number" TEXT NOT NULL,
 "issuer" TEXT NOT NULL DEFAULT '',
 "sourceUrl" TEXT NOT NULL,
 "checkedAt" TEXT NOT NULL,
 "checkedBy" TEXT NOT NULL,
 "validUntil" TEXT,
 "status" TEXT NOT NULL,
 "applicability" TEXT NOT NULL,
 "note" TEXT NOT NULL DEFAULT '',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "archivedBy" TEXT,
 "archivedAt" TIMESTAMP(3),
 CONSTRAINT "ComplianceEvidence_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("type" IN ('software_registry','hardware_registry','certificate')),
 CHECK ("status" IN ('confirmed','expired','revoked','unverified')),
 CHECK (length("number") BETWEEN 1 AND 100),
 CHECK ("sourceUrl" ~ '^https?://'),
 CHECK ("checkedAt" ~ '^\d{4}-\d{2}-\d{2}$'),
 CHECK ("validUntil" IS NULL OR "validUntil" ~ '^\d{4}-\d{2}-\d{2}$'),
 CHECK (length(btrim("applicability")) BETWEEN 1 AND 500),
 CHECK ("productRevision" IS NULL OR "productRevision" > 0),
 CHECK ("revision" > 0),
 CHECK (("archivedAt" IS NULL) = ("archivedBy" IS NULL))
);
CREATE INDEX "ComplianceEvidence_productId_archivedAt_idx" ON "ComplianceEvidence"("productId", "archivedAt");
