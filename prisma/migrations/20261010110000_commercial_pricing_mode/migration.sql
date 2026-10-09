ALTER TABLE "Calculation" ADD COLUMN "pricingMode" TEXT NOT NULL DEFAULT 'legacy_markup';
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_pricingMode_check"
  CHECK ("pricingMode" IN ('legacy_markup', 'markup', 'target_margin'));
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_targetMargin_check"
  CHECK ("pricingMode" <> 'target_margin' OR ("marginPercent" >= 0 AND "marginPercent" < 100));
