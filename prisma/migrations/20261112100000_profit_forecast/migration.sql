-- #103 4.5: прогноз итоговой прибыли. Подтверждённая оценка оставшейся работы
-- по этапу и по РП. NULL — оценка не подтверждена (неизвестно, а не ноль).
-- *ActualBaseline — факт в момент оценки: если факт с тех пор изменился,
-- оценка считается устаревшей и прогноз помечается неполным.

ALTER TABLE "Stage"
 ADD COLUMN "remainingHoursEstimate" DOUBLE PRECISION,
 ADD COLUMN "remainingActualBaseline" DOUBLE PRECISION,
 ADD COLUMN "remainingEstimatedBy" TEXT,
 ADD COLUMN "remainingEstimatedAt" TIMESTAMP(3),
 ADD CONSTRAINT "Stage_remainingHoursEstimate_check"
  CHECK ("remainingHoursEstimate" IS NULL OR "remainingHoursEstimate" >= 0),
 ADD CONSTRAINT "Stage_remainingActualBaseline_check"
  CHECK ("remainingActualBaseline" IS NULL OR "remainingActualBaseline" >= 0);

ALTER TABLE "Calculation"
 ADD COLUMN "remainingPmHoursEstimate" DOUBLE PRECISION,
 ADD COLUMN "remainingPmActualBaseline" DOUBLE PRECISION,
 ADD COLUMN "remainingPmEstimatedBy" TEXT,
 ADD COLUMN "remainingPmEstimatedAt" TIMESTAMP(3),
 ADD CONSTRAINT "Calculation_remainingPmHoursEstimate_check"
  CHECK ("remainingPmHoursEstimate" IS NULL OR "remainingPmHoursEstimate" >= 0),
 ADD CONSTRAINT "Calculation_remainingPmActualBaseline_check"
  CHECK ("remainingPmActualBaseline" IS NULL OR "remainingPmActualBaseline" >= 0);
