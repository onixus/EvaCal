CREATE TABLE "CatalogVendor" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "archived" BOOLEAN NOT NULL DEFAULT false, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("revision" > 0), CHECK (length("name") BETWEEN 1 AND 200)
);
CREATE TABLE "CatalogProduct" (
 "id" TEXT PRIMARY KEY, "vendorId" TEXT NOT NULL REFERENCES "CatalogVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "revision" INTEGER NOT NULL DEFAULT 1, "archived" BOOLEAN NOT NULL DEFAULT false,
 "name" TEXT NOT NULL, "sku" TEXT NOT NULL, "edition" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "unit" TEXT NOT NULL, "licensing" TEXT NOT NULL,
 "attributes" JSONB NOT NULL, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("revision" > 0), CHECK ("kind" IN ('hardware','software','license','support','service','other'))
);
CREATE INDEX "CatalogProduct_vendorId_archived_idx" ON "CatalogProduct"("vendorId", "archived");
CREATE TABLE "CatalogOffer" (
 "id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "productRevision" INTEGER NOT NULL CHECK ("productRevision" > 0),
 "source" TEXT NOT NULL, "unitPrice" DECIMAL(18,6), "currency" TEXT NOT NULL,
 "region" TEXT NOT NULL, "terms" TEXT NOT NULL, "priceDate" TEXT, "validUntil" TEXT,
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0), CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE INDEX "CatalogOffer_productId_createdAt_idx" ON "CatalogOffer"("productId", "createdAt");
