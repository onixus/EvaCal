-- Tax and discount category of an offer; a missing tax rate stays unknown (NULL), never 0.
ALTER TABLE "CatalogOffer" ADD COLUMN "taxRate" DECIMAL(7,4);
ALTER TABLE "CatalogOffer" ADD COLUMN "discountCategory" TEXT NOT NULL DEFAULT '';
-- Explicit «Без НДС»: rate 0 by exemption, distinct from an unknown (NULL) rate.
ALTER TABLE "CatalogOffer" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false;
-- Explicit confirmation status of an offer.
ALTER TABLE "CatalogOffer" ADD COLUMN "confirmationStatus" TEXT NOT NULL DEFAULT 'unconfirmed';
ALTER TABLE "CatalogOffer" ADD COLUMN "confirmedBy" TEXT;
ALTER TABLE "CatalogOffer" ADD COLUMN "confirmedAt" TIMESTAMP(3);
-- GPL offers were only ever inserted by the explicit import confirmation, which
-- recorded the confirming user in importProvenance. Manual offers stay unconfirmed.
UPDATE "CatalogOffer"
SET "confirmationStatus" = 'confirmed',
    "confirmedBy" = "importProvenance"->>'confirmedBy',
    "confirmedAt" = "createdAt"
WHERE "importProvenance" IS NOT NULL AND "importProvenance"->>'confirmedBy' IS NOT NULL;

CREATE TABLE "CatalogImportProfile" (
 "id" TEXT NOT NULL PRIMARY KEY, "vendorId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "format" TEXT NOT NULL, "profile" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "archived" BOOLEAN NOT NULL DEFAULT false, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedBy" TEXT NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CatalogImportProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "CatalogVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CatalogImportProfile_vendorId_format_name_idx" ON "CatalogImportProfile"("vendorId", "format", "name");
-- Archived profiles release their name; uniqueness applies only to active ones.
CREATE UNIQUE INDEX "CatalogImportProfile_active_name_key" ON "CatalogImportProfile"("vendorId", "format", "name") WHERE NOT "archived";
