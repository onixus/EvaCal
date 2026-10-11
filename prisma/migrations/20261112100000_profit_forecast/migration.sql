-- #103 4.5: прогноз итоговой прибыли. Подтверждённая оценка оставшейся работы
-- по этапу и по РП. NULL — оценка не подтверждена (неизвестно, а не ноль).

ALTER TABLE "Stage"
 ADD COLUMN "remainingHoursEstimate" DOUBLE PRECISION,
 ADD COLUMN "remainingEstimatedBy" TEXT,
 ADD COLUMN "remainingEstimatedAt" TIMESTAMP(3),
 ADD CONSTRAINT "Stage_remainingHoursEstimate_check"
  CHECK ("remainingHoursEstimate" IS NULL OR "remainingHoursEstimate" >= 0);

ALTER TABLE "Calculation"
 ADD COLUMN "remainingPmHoursEstimate" DOUBLE PRECISION,
 ADD COLUMN "remainingPmEstimatedBy" TEXT,
 ADD COLUMN "remainingPmEstimatedAt" TIMESTAMP(3),
 ADD CONSTRAINT "Calculation_remainingPmHoursEstimate_check"
  CHECK ("remainingPmHoursEstimate" IS NULL OR "remainingPmHoursEstimate" >= 0);
