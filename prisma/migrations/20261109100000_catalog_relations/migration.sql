-- #101: subscription and bundle item kinds.
ALTER TABLE "CatalogProduct" DROP CONSTRAINT IF EXISTS "CatalogProduct_kind_check";
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_kind_check"
  CHECK ("kind" IN ('hardware','software','license','support','service','subscription','bundle','other'));

-- Replaced/alternative products and bundle composition. Cycles are checked by the API
-- under an advisory lock; the database guards self-relations and quantity shape.
CREATE TABLE "CatalogProductRelation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "fromProductId" TEXT NOT NULL,
 "toProductId" TEXT NOT NULL,
 "type" TEXT NOT NULL,
 "quantity" DECIMAL(18,6),
 "note" TEXT NOT NULL DEFAULT '',
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "archivedBy" TEXT,
 "archivedAt" TIMESTAMP(3),
 CONSTRAINT "CatalogProductRelation_fromProductId_fkey" FOREIGN KEY ("fromProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CatalogProductRelation_toProductId_fkey" FOREIGN KEY ("toProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("type" IN ('replaces','alternative','bundleComponent')),
 CHECK ("fromProductId" <> "toProductId"),
 CHECK (("type" = 'bundleComponent' AND "quantity" IS NOT NULL AND "quantity" > 0)
     OR ("type" <> 'bundleComponent' AND "quantity" IS NULL)),
 CHECK (length("note") <= 1000),
 CHECK (("archivedAt" IS NULL) = ("archivedBy" IS NULL))
);
CREATE INDEX "CatalogProductRelation_fromProductId_type_idx" ON "CatalogProductRelation"("fromProductId", "type");
CREATE INDEX "CatalogProductRelation_toProductId_type_idx" ON "CatalogProductRelation"("toProductId", "type");
-- Archived relations keep history; uniqueness applies to active ones only.
CREATE UNIQUE INDEX "CatalogProductRelation_active_key" ON "CatalogProductRelation"("fromProductId", "toProductId", "type") WHERE "archivedAt" IS NULL;

CREATE TABLE "CatalogAttributeDefinition" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "key" TEXT NOT NULL,
 "label" TEXT NOT NULL,
 "valueType" TEXT NOT NULL,
 "unit" TEXT,
 "allowedUnits" JSONB,
 "enumValues" JSONB,
 "archived" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("valueType" IN ('text','number','boolean','enum')),
 CHECK (length("key") BETWEEN 1 AND 100),
 CHECK (length("label") BETWEEN 1 AND 100),
 CHECK ("revision" > 0),
 CHECK ("valueType" <> 'enum' OR "enumValues" IS NOT NULL)
);
CREATE UNIQUE INDEX "CatalogAttributeDefinition_key_key" ON "CatalogAttributeDefinition"("key");

CREATE TABLE "CatalogSuggestion" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "calculationId" TEXT NOT NULL,
 "specificationVersion" INTEGER NOT NULL,
 "itemSnapshot" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending',
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewer" TEXT,
 "reviewedAt" TIMESTAMP(3),
 "comment" TEXT NOT NULL DEFAULT '',
 "createdProductId" TEXT,
 CONSTRAINT "CatalogSuggestion_createdProductId_fkey" FOREIGN KEY ("createdProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("status" IN ('pending','accepted','rejected')),
 CHECK ("specificationVersion" > 0),
 CHECK (("status" = 'pending') = ("reviewedAt" IS NULL)),
 CHECK (("status" = 'pending') = ("reviewer" IS NULL)),
 CHECK ("createdProductId" IS NULL OR "status" = 'accepted'),
 CHECK (length("comment") <= 1000)
);
CREATE INDEX "CatalogSuggestion_status_createdAt_idx" ON "CatalogSuggestion"("status", "createdAt");
CREATE INDEX "CatalogSuggestion_calculationId_idx" ON "CatalogSuggestion"("calculationId");
