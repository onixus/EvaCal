-- Specification lifecycle: draft → review → confirmed → released.
-- Existing rows keep draft/confirmed; released is set only when a GOST package is issued.
ALTER TABLE "SpecificationVersion" DROP CONSTRAINT "SpecificationVersion_status_check";
ALTER TABLE "SpecificationVersion" ADD CONSTRAINT "SpecificationVersion_status_check"
  CHECK ("status" IN ('draft', 'review', 'confirmed', 'released'));
