-- #103 WP-4b: решение приёмочной комиссии по утверждённой редакции комплекта.
-- Перечисления — TEXT + CHECK; решения только дописываются (триггер ниже).
-- CreateTable
CREATE TABLE "AcceptanceDecision" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "commission" JSONB NOT NULL,
    "basis" TEXT NOT NULL,
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "checksSnapshot" JSONB NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptanceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcceptanceDecision_packageId_decidedAt_idx" ON "AcceptanceDecision"("packageId", "decidedAt");

-- AddForeignKey
ALTER TABLE "AcceptanceDecision" ADD CONSTRAINT "AcceptanceDecision_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "GostPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "AcceptanceDecision" ADD CONSTRAINT "AcceptanceDecision_decision_check"
  CHECK ("decision" IN ('accepted', 'accepted_with_remarks', 'rejected'));
ALTER TABLE "AcceptanceDecision" ADD CONSTRAINT "AcceptanceDecision_basis_check"
  CHECK (btrim("basis") <> '');
-- Решение без состава комиссии не бывает.
ALTER TABLE "AcceptanceDecision" ADD CONSTRAINT "AcceptanceDecision_commission_check"
  CHECK (jsonb_typeof("commission") = 'array' AND jsonb_array_length("commission") > 0);
ALTER TABLE "AcceptanceDecision" ADD CONSTRAINT "AcceptanceDecision_snapshot_check"
  CHECK (jsonb_typeof("checksSnapshot") = 'array' AND jsonb_array_length("checksSnapshot") > 0);
-- «Принять с замечаниями» — только с явным перечнем; «принять» — без него.
ALTER TABLE "AcceptanceDecision" ADD CONSTRAINT "AcceptanceDecision_exceptions_check"
  CHECK (jsonb_typeof("exceptions") = 'array'
    AND ("decision" <> 'accepted_with_remarks' OR jsonb_array_length("exceptions") > 0)
    AND ("decision" <> 'accepted' OR jsonb_array_length("exceptions") = 0));

-- Решения неизменяемы: новое решение — новая строка. Удаление не запрещается,
-- чтобы работал каскад при удалении комплекта.
CREATE FUNCTION "acceptance_decision_immutable"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AcceptanceDecision is append-only: record a new decision instead';
END;
$$;

CREATE TRIGGER "AcceptanceDecision_no_update"
  BEFORE UPDATE ON "AcceptanceDecision"
  FOR EACH ROW EXECUTE FUNCTION "acceptance_decision_immutable"();
