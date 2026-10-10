CREATE TABLE "CatalogImport" (
 "id" TEXT NOT NULL PRIMARY KEY, "vendorId" TEXT NOT NULL, "filename" TEXT NOT NULL,
 "checksum" TEXT NOT NULL, "file" BYTEA NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'draft', "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "confirmedBy" TEXT, "confirmedAt" TIMESTAMP(3),
 CONSTRAINT "CatalogImport_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "CatalogVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogImport_vendorId_checksum_key" ON "CatalogImport"("vendorId", "checksum");
CREATE TABLE "CatalogImportRevision" (
 "id" TEXT NOT NULL PRIMARY KEY, "importId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "data" JSONB NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CatalogImportRevision_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CatalogImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogImportRevision_importId_revision_key" ON "CatalogImportRevision"("importId", "revision");
ALTER TABLE "CatalogOffer" ADD COLUMN "importProvenance" JSONB;
