-- #103 WP-5e: явные зависимости этапов и сохранённые сравнения вариантов плана.

CREATE TABLE "StageDependency" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "calculationId" TEXT NOT NULL,
 "fromStageId" TEXT NOT NULL,
 "toStageId" TEXT NOT NULL,
 "type" TEXT NOT NULL DEFAULT 'FS',
 "lagDays" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 -- Пока только «окончание → начало»; SS/FF добавятся расширением списка.
 CHECK ("type" IN ('FS')),
 CHECK ("lagDays" >= 0 AND "lagDays" <= 365),
 -- Этап не зависит от самого себя; циклы длиннее одного ребра отсекает API.
 CHECK ("fromStageId" <> "toStageId"),
 CONSTRAINT "StageDependency_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "StageDependency_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "StageDependency_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StageDependency_fromStageId_toStageId_key" ON "StageDependency"("fromStageId", "toStageId");
CREATE INDEX "StageDependency_calculationId_idx" ON "StageDependency"("calculationId");
CREATE INDEX "StageDependency_toStageId_idx" ON "StageDependency"("toStageId");

CREATE TABLE "PlanScenario" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "name" TEXT NOT NULL,
 "createdBy" TEXT NOT NULL,
 "variants" JSONB NOT NULL,
 "result" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (length("name") BETWEEN 1 AND 200)
);
CREATE INDEX "PlanScenario_createdAt_idx" ON "PlanScenario"("createdAt");
