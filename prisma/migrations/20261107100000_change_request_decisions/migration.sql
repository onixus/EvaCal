-- #103 WP-2b: решения по запросам на изменение, новая версия после принятия,
-- первоначальная договорная база проекта и защита базы/результата от удаления.

ALTER TABLE "Project" ADD COLUMN "baselineCalculationId" TEXT;

ALTER TABLE "ChangeRequest" ADD COLUMN "estimateBaseHash" TEXT;
-- Отпечаток базы существует только вместе с оценкой.
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_estimate_hash_check"
  CHECK ("estimateBaseHash" IS NULL OR "estimatedAt" IS NOT NULL);
-- Принятый запрос всегда указывает на созданную им версию расчёта, а версия
-- комплекта появляется только при наличии базового комплекта.
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_accepted_result_check"
  CHECK ("status" <> 'accepted' OR "resultCalculationId" IS NOT NULL);
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_result_only_accepted_check"
  CHECK ("status" = 'accepted' OR ("resultCalculationId" IS NULL AND "resultPackageId" IS NULL));
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_result_package_check"
  CHECK ("resultPackageId" IS NULL OR "basePackageId" IS NOT NULL);

CREATE INDEX "ChangeRequest_resultCalculationId_idx" ON "ChangeRequest"("resultCalculationId");
CREATE INDEX "ChangeRequest_basePackageId_idx" ON "ChangeRequest"("basePackageId");
CREATE INDEX "ChangeRequest_resultPackageId_idx" ON "ChangeRequest"("resultPackageId");

-- База и результат запроса — часть истории договора: их удаление (в том числе
-- каскадом комплекта при удалении расчёта) запрещено на уровне СУБД. API
-- проверяет то же заранее и отвечает 409.
CREATE FUNCTION "ChangeRequest_protect_calculation"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ChangeRequest"
    WHERE "baseCalculationId" = OLD."id" OR "resultCalculationId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'Calculation % is referenced by a change request', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Calculation_change_request_guard"
  BEFORE DELETE ON "Calculation"
  FOR EACH ROW EXECUTE FUNCTION "ChangeRequest_protect_calculation"();

CREATE FUNCTION "ChangeRequest_protect_package"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ChangeRequest"
    WHERE "basePackageId" = OLD."id" OR "resultPackageId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'GostPackage % is referenced by a change request', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GostPackage_change_request_guard"
  BEFORE DELETE ON "GostPackage"
  FOR EACH ROW EXECUTE FUNCTION "ChangeRequest_protect_package"();
