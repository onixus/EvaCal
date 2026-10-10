-- #103 WP-6a: журнал факта (ActualEntry), прогоны синхронизации и
-- сопоставление внешних задач с этапами. Stage.actualHours/actualStartDate/
-- actualEndDate остаются и становятся агрегатом неудалённых записей журнала.

CREATE TABLE "ActualEntry" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "stageId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalTaskKey" TEXT,
    "author" TEXT,
    "hours" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "externalUpdatedAt" TIMESTAMP(3),
    "basis" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActualEntry_pkey" PRIMARY KEY ("id"),
    -- 'csv' | 'manual' | идентификатор трекера; конкретный трекер ещё не выбран.
    CONSTRAINT "ActualEntry_source_check" CHECK ("source" ~ '^[a-z][a-z0-9_-]{0,31}$'),
    CONSTRAINT "ActualEntry_externalId_check" CHECK (length("externalId") BETWEEN 1 AND 200),
    -- Отрицательными могут быть только ручные поправки (см. docs/actuals-ledger.md).
    CONSTRAINT "ActualEntry_hours_check" CHECK ("hours" IS NULL OR "source" = 'manual' OR "hours" >= 0)
);

CREATE TABLE "ActualSyncRun" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'incremental',
    "startedBy" TEXT,
    "cursor" TEXT,
    "manualHours" TEXT,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActualSyncRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ActualSyncRun_source_check" CHECK ("source" ~ '^[a-z][a-z0-9_-]{0,31}$'),
    CONSTRAINT "ActualSyncRun_mode_check" CHECK ("mode" IN ('incremental', 'full')),
    CONSTRAINT "ActualSyncRun_manualHours_check" CHECK ("manualHours" IS NULL OR "manualHours" IN ('auto', 'replace', 'add')),
    CONSTRAINT "ActualSyncRun_counts_check" CHECK (
        "created" >= 0 AND "updated" >= 0 AND "unchanged" >= 0 AND "deleted" >= 0 AND "skipped" >= 0
    )
);

CREATE TABLE "ExternalTaskMapping" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalTaskKey" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalTaskMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExternalTaskMapping_source_check" CHECK ("source" ~ '^[a-z][a-z0-9_-]{0,31}$'),
    CONSTRAINT "ExternalTaskMapping_key_check" CHECK (length("externalTaskKey") BETWEEN 1 AND 200)
);

CREATE INDEX "ActualEntry_stageId_idx" ON "ActualEntry"("stageId");
CREATE UNIQUE INDEX "ActualEntry_calculationId_source_externalId_key" ON "ActualEntry"("calculationId", "source", "externalId");
CREATE INDEX "ActualSyncRun_calculationId_source_createdAt_idx" ON "ActualSyncRun"("calculationId", "source", "createdAt");
CREATE UNIQUE INDEX "ExternalTaskMapping_calculationId_source_externalTaskKey_key" ON "ExternalTaskMapping"("calculationId", "source", "externalTaskKey");

ALTER TABLE "ActualEntry" ADD CONSTRAINT "ActualEntry_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActualEntry" ADD CONSTRAINT "ActualEntry_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActualSyncRun" ADD CONSTRAINT "ActualSyncRun_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalTaskMapping" ADD CONSTRAINT "ExternalTaskMapping_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalTaskMapping" ADD CONSTRAINT "ExternalTaskMapping_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Перенос уже внесённого факта: каждый этап с часами или датами факта получает
-- одну ручную запись с тем же externalId, что пишет ручная правка
-- ('stage:<id>'), поэтому агрегат после миграции совпадает с прежними значениями.
INSERT INTO "ActualEntry" (
    "id", "calculationId", "stageId", "source", "externalId",
    "hours", "startDate", "endDate", "syncedAt", "createdAt", "updatedAt"
)
SELECT
    'ae_' || md5("id"), "calculationId", "id", 'manual', 'stage:' || "id",
    "actualHours", "actualStartDate", "actualEndDate",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Stage"
WHERE ("actualHours" IS NOT NULL OR "actualStartDate" IS NOT NULL OR "actualEndDate" IS NOT NULL);
