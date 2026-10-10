-- Historical identity cannot be reconstructed from a mutable current product.
-- Preserve old offers as unknown; never backfill them with today's identity.
ALTER TABLE "CatalogOffer" ADD COLUMN "productSnapshot" JSONB;
