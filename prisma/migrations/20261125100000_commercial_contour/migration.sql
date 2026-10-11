-- #101 §3 / #103 §4.2–4.3: коммерческий контур.
-- Курсы валют, дополнительные статьи затрат, закреплённая редакция спецификации
-- в КП, порог маржи шаблона/расчёта и согласование скидки ниже порога.
-- Существующие расчёты получают NULL: поставка и статьи в их КП не входят,
-- порога нет — исторические КП воспроизводятся без изменений.

ALTER TABLE "Calculation"
 ADD COLUMN "minMarginPercent" DOUBLE PRECISION,
 ADD COLUMN "pinnedSpecificationVersion" INTEGER,
 ADD CONSTRAINT "Calculation_minMarginPercent_check"
  CHECK ("minMarginPercent" IS NULL OR ("minMarginPercent" >= 0 AND "minMarginPercent" < 100)),
 ADD CONSTRAINT "Calculation_pinnedSpecificationVersion_check"
  CHECK ("pinnedSpecificationVersion" IS NULL OR "pinnedSpecificationVersion" > 0);

ALTER TABLE "FormTemplate"
 ADD COLUMN "minMarginPercent" DOUBLE PRECISION,
 ADD CONSTRAINT "FormTemplate_minMarginPercent_check"
  CHECK ("minMarginPercent" IS NULL OR ("minMarginPercent" >= 0 AND "minMarginPercent" < 100));

CREATE TABLE "ExchangeRate" (
 "id" TEXT NOT NULL,
 "from" TEXT NOT NULL,
 "to" TEXT NOT NULL,
 "rate" DECIMAL(18,8) NOT NULL,
 "date" DATE NOT NULL,
 "source" TEXT NOT NULL,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ExchangeRate_rate_check" CHECK ("rate" > 0),
 CONSTRAINT "ExchangeRate_currency_check"
  CHECK ("from" ~ '^[A-Z]{3}$' AND "to" ~ '^[A-Z]{3}$' AND "from" <> "to"),
 CONSTRAINT "ExchangeRate_source_check" CHECK (length(trim("source")) > 0)
);

CREATE TABLE "CostItem" (
 "id" TEXT NOT NULL,
 "calculationId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "description" TEXT NOT NULL,
 "quantity" DECIMAL(18,6) NOT NULL,
 "unitCost" DECIMAL(18,6),
 "currency" TEXT NOT NULL,
 "exchangeRate" DECIMAL(18,8),
 "exchangeRateDate" DATE,
 "exchangeRateSource" TEXT,
 "specItemRef" TEXT,
 "order" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CostItem_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "CostItem_kind_check"
  CHECK ("kind" IN ('subcontractor', 'travel', 'equipment', 'license', 'other')),
 CONSTRAINT "CostItem_amount_check"
  CHECK ("quantity" >= 0 AND ("unitCost" IS NULL OR "unitCost" >= 0)),
 CONSTRAINT "CostItem_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
 CONSTRAINT "CostItem_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRateDate" IS NOT NULL
   AND "exchangeRateSource" IS NOT NULL))
);

CREATE TABLE "DiscountApproval" (
 "id" TEXT NOT NULL,
 "calculationId" TEXT NOT NULL,
 "requestedPercent" DOUBLE PRECISION NOT NULL,
 "resultingMargin" DOUBLE PRECISION,
 "minMarginPercent" DOUBLE PRECISION NOT NULL,
 "termsFingerprint" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending',
 "requestedBy" TEXT NOT NULL,
 "comment" TEXT,
 "decidedBy" TEXT,
 "decidedAt" TIMESTAMP(3),
 "decisionComment" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "DiscountApproval_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "DiscountApproval_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn')),
 CONSTRAINT "DiscountApproval_fingerprint_check" CHECK ("termsFingerprint" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "DiscountApproval_percent_check"
  CHECK ("requestedPercent" >= 0 AND "requestedPercent" <= 100),
 CONSTRAINT "DiscountApproval_decision_check"
  CHECK ("status" IN ('pending', 'withdrawn') OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL))
);

CREATE INDEX "ExchangeRate_from_to_date_idx" ON "ExchangeRate"("from", "to", "date");
CREATE UNIQUE INDEX "ExchangeRate_from_to_date_source_key" ON "ExchangeRate"("from", "to", "date", "source");
CREATE INDEX "CostItem_calculationId_order_idx" ON "CostItem"("calculationId", "order");
CREATE INDEX "DiscountApproval_calculationId_createdAt_idx" ON "DiscountApproval"("calculationId", "createdAt");

ALTER TABLE "CostItem" ADD CONSTRAINT "CostItem_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscountApproval" ADD CONSTRAINT "DiscountApproval_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
