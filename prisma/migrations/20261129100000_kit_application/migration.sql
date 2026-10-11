-- #103 WP-7b: применение наборов решений к проектам и предложения обновлений.
-- Перечисления — TEXT + CHECK. Правила — docs/kit-application.md.

-- Происхождение элементов: `kit:<kitId>@<version>#<elementId>`; null — вручную.
ALTER TABLE "Stage" ADD COLUMN "originRef" TEXT;
ALTER TABLE "Risk" ADD COLUMN "originRef" TEXT;
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_originRef_check"
  CHECK ("originRef" IS NULL OR "originRef" ~ '^kit:[^@#]+@[0-9]+#.+$');
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_originRef_check"
  CHECK ("originRef" IS NULL OR "originRef" ~ '^kit:[^@#]+@[0-9]+#.+$');

CREATE TABLE "KitApplication" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'apply',
    "kitId" TEXT NOT NULL,
    "kitVersionId" TEXT NOT NULL,
    "fromVersionId" TEXT,
    "calculationId" TEXT NOT NULL,
    "packageId" TEXT,
    "selection" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "appliedBy" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitApplication_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KitApplication_kind_check" CHECK ("kind" IN ('apply', 'update')),
    CONSTRAINT "KitApplication_from_check" CHECK (("kind" = 'update') = ("fromVersionId" IS NOT NULL)),
    CONSTRAINT "KitApplication_selection_check" CHECK (jsonb_typeof("selection") = 'object'),
    CONSTRAINT "KitApplication_mapping_check" CHECK (jsonb_typeof("mapping") = 'object')
);

CREATE INDEX "KitApplication_calculationId_appliedAt_idx" ON "KitApplication"("calculationId", "appliedAt");
CREATE INDEX "KitApplication_kitId_appliedAt_idx" ON "KitApplication"("kitId", "appliedAt");

ALTER TABLE "KitApplication" ADD CONSTRAINT "KitApplication_kitVersionId_fkey" FOREIGN KEY ("kitVersionId") REFERENCES "SolutionKitVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitApplication" ADD CONSTRAINT "KitApplication_fromVersionId_fkey" FOREIGN KEY ("fromVersionId") REFERENCES "SolutionKitVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitApplication" ADD CONSTRAINT "KitApplication_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitApplication" ADD CONSTRAINT "KitApplication_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "GostPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Применяется только утверждённая версия набора (архивную применить нельзя;
-- для update и исходная версия не может быть черновиком), kitId совпадает.
-- Запись неизменна: допускается лишь обнуление packageId при удалении комплекта.
CREATE FUNCTION "kit_application_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "kitId", "status" INTO v FROM "SolutionKitVersion" WHERE "id" = NEW."kitVersionId";
    IF v."status" IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'KitApplication: kit version % is not approved', NEW."kitVersionId";
    END IF;
    IF v."kitId" <> NEW."kitId" THEN
      RAISE EXCEPTION 'KitApplication: kitId does not match kit version';
    END IF;
    IF NEW."fromVersionId" IS NOT NULL THEN
      SELECT "kitId", "status" INTO v FROM "SolutionKitVersion" WHERE "id" = NEW."fromVersionId";
      IF v."kitId" <> NEW."kitId" OR v."status" = 'draft' THEN
        RAISE EXCEPTION 'KitApplication: fromVersion must be a non-draft version of the same kit';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."packageId" IS NULL
     AND OLD."packageId" IS NOT NULL
     AND (to_jsonb(NEW) - 'packageId') = (to_jsonb(OLD) - 'packageId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'KitApplication is immutable';
END;
$$;

CREATE TRIGGER "KitApplication_guard"
  BEFORE INSERT OR UPDATE ON "KitApplication"
  FOR EACH ROW EXECUTE FUNCTION "kit_application_guard"();
