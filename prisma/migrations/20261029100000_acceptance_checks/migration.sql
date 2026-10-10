-- #103 WP-4a: проверки приёмки по требованиям конкретной редакции комплекта.
-- Перечисления хранятся как TEXT + CHECK (см. 20261010110000_commercial_pricing_mode).
-- Результаты проверок только дописываются: UPDATE запрещён триггером ниже.
-- CreateTable
CREATE TABLE "AcceptanceCheck" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "method" TEXT,
    "criteria" TEXT[],
    "order" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptanceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceResult" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "executorName" TEXT,
    "executorId" TEXT,
    "executedAt" TIMESTAMP(3),
    "actualResult" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptanceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceRemark" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "resultId" TEXT,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "retestResultId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "AcceptanceRemark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcceptanceCheck_calculationId_idx" ON "AcceptanceCheck"("calculationId");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptanceCheck_packageId_requirementId_key" ON "AcceptanceCheck"("packageId", "requirementId");

-- CreateIndex
CREATE INDEX "AcceptanceResult_checkId_createdAt_idx" ON "AcceptanceResult"("checkId", "createdAt");

-- CreateIndex
CREATE INDEX "AcceptanceRemark_checkId_status_idx" ON "AcceptanceRemark"("checkId", "status");

-- AddForeignKey
ALTER TABLE "AcceptanceCheck" ADD CONSTRAINT "AcceptanceCheck_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "GostPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceResult" ADD CONSTRAINT "AcceptanceResult_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "AcceptanceCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceRemark" ADD CONSTRAINT "AcceptanceRemark_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "AcceptanceCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceRemark" ADD CONSTRAINT "AcceptanceRemark_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AcceptanceResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceRemark" ADD CONSTRAINT "AcceptanceRemark_retestResultId_fkey" FOREIGN KEY ("retestResultId") REFERENCES "AcceptanceResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "AcceptanceRemarkEdit" (
    "id" TEXT NOT NULL,
    "remarkId" TEXT NOT NULL,
    "previousText" TEXT NOT NULL,
    "newText" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptanceRemarkEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceEvidence" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "resultId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptanceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcceptanceRemarkEdit_remarkId_editedAt_idx" ON "AcceptanceRemarkEdit"("remarkId", "editedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptanceEvidence_key_key" ON "AcceptanceEvidence"("key");

-- CreateIndex
CREATE INDEX "AcceptanceEvidence_checkId_resultId_idx" ON "AcceptanceEvidence"("checkId", "resultId");

-- AddForeignKey
ALTER TABLE "AcceptanceRemarkEdit" ADD CONSTRAINT "AcceptanceRemarkEdit_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "AcceptanceRemark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceEvidence" ADD CONSTRAINT "AcceptanceEvidence_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "AcceptanceCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceEvidence" ADD CONSTRAINT "AcceptanceEvidence_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AcceptanceResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcceptanceCheck" ADD CONSTRAINT "AcceptanceCheck_method_check"
  CHECK ("method" IS NULL OR "method" IN ('INSPECTION', 'ANALYSIS', 'DEMONSTRATION', 'TEST'));

ALTER TABLE "AcceptanceResult" ADD CONSTRAINT "AcceptanceResult_status_check"
  CHECK ("status" IN ('not_run', 'passed', 'failed', 'blocked'));
-- «Пройдена» и «не пройдена» без исполнителя, даты и фактического результата
-- не бывает: каждый результат проверки имеет источник.
ALTER TABLE "AcceptanceResult" ADD CONSTRAINT "AcceptanceResult_executed_check"
  CHECK ("status" NOT IN ('passed', 'failed')
    OR (btrim(COALESCE("executorName", '')) <> ''
      AND "executedAt" IS NOT NULL
      AND btrim(COALESCE("actualResult", '')) <> ''));
ALTER TABLE "AcceptanceResult" ADD CONSTRAINT "AcceptanceResult_evidence_check"
  CHECK (jsonb_typeof("evidence") = 'array');

ALTER TABLE "AcceptanceRemark" ADD CONSTRAINT "AcceptanceRemark_status_check"
  CHECK ("status" IN ('open', 'resolved', 'verified'));
ALTER TABLE "AcceptanceRemark" ADD CONSTRAINT "AcceptanceRemark_text_check"
  CHECK (btrim("text") <> '');
ALTER TABLE "AcceptanceRemark" ADD CONSTRAINT "AcceptanceRemark_resolved_check"
  CHECK ("status" = 'open' OR ("resolvedBy" IS NOT NULL AND "resolvedAt" IS NOT NULL));
-- Снять замечание можно только ссылкой на повторную проверку.
ALTER TABLE "AcceptanceRemark" ADD CONSTRAINT "AcceptanceRemark_verified_check"
  CHECK ("status" <> 'verified'
    OR ("verifiedBy" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "retestResultId" IS NOT NULL));

ALTER TABLE "AcceptanceEvidence" ADD CONSTRAINT "AcceptanceEvidence_size_check"
  CHECK ("size" > 0);

-- Журнал результатов неизменяем: повторная проверка — новая строка. Удаление
-- не запрещается, чтобы работал каскад при удалении комплекта.
CREATE FUNCTION "acceptance_result_immutable"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AcceptanceResult is append-only: record a new result instead';
END;
$$;

CREATE TRIGGER "AcceptanceResult_no_update"
  BEFORE UPDATE ON "AcceptanceResult"
  FOR EACH ROW EXECUTE FUNCTION "acceptance_result_immutable"();
