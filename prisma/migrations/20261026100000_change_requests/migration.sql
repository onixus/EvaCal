-- #103 WP-2a: запросы на изменение требований и журнал их согласования.
-- Ссылки на проект, расчёт и комплект — без внешних ключей: запрос не должен
-- каскадно менять договорную базу, а общие модели остаются без изменений.

CREATE TABLE "ChangeRequest" (
 "id" TEXT NOT NULL,
 "projectId" TEXT NOT NULL,
 "seq" INTEGER NOT NULL,
 "title" TEXT NOT NULL,
 "initiator" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'draft',
 "baseCalculationId" TEXT NOT NULL,
 "basePackageId" TEXT,
 "affectedRequirements" JSONB NOT NULL DEFAULT '[]',
 "proposedChanges" JSONB NOT NULL DEFAULT '{}',
 "impact" JSONB,
 "confirmedHours" DOUBLE PRECISION,
 "confirmedCost" DECIMAL(18,2),
 "confirmedScheduleDays" INTEGER,
 "estimateComment" TEXT,
 "estimatedBy" TEXT,
 "estimatedAt" TIMESTAMP(3),
 "decidedBy" TEXT,
 "decidedAt" TIMESTAMP(3),
 "resultCalculationId" TEXT,
 "resultPackageId" TEXT,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id"),
 CHECK ("status" IN ('draft', 'submitted', 'accepted', 'rejected', 'deferred')),
 CHECK ("seq" > 0),
 CHECK (length("title") BETWEEN 1 AND 200),
 CHECK (length("initiator") BETWEEN 1 AND 200),
 CHECK (length("reason") BETWEEN 1 AND 4000),
 CHECK (jsonb_typeof("affectedRequirements") = 'array'),
 CHECK (jsonb_typeof("proposedChanges") = 'object'),
 -- Изменение может и сокращать объём, поэтому значения со знаком, но в разумных пределах.
 CHECK ("confirmedHours" IS NULL OR ("confirmedHours" BETWEEN -100000 AND 100000)),
 CHECK ("confirmedScheduleDays" IS NULL OR ("confirmedScheduleDays" BETWEEN -3650 AND 3650)),
 -- Оценка вводится целиком: часы, стоимость, срок, автор и момент — вместе.
 CHECK (
   ("estimatedAt" IS NULL AND "estimatedBy" IS NULL AND "confirmedHours" IS NULL
     AND "confirmedCost" IS NULL AND "confirmedScheduleDays" IS NULL)
   OR
   ("estimatedAt" IS NOT NULL AND "estimatedBy" IS NOT NULL AND "confirmedHours" IS NOT NULL
     AND "confirmedCost" IS NOT NULL AND "confirmedScheduleDays" IS NOT NULL)
 ),
 -- Принять можно только оценённый запрос.
 CHECK ("status" <> 'accepted' OR "estimatedAt" IS NOT NULL),
 -- Решение фиксируется вместе с автором.
 CHECK (("decidedAt" IS NULL) = ("decidedBy" IS NULL)),
 CHECK ("status" NOT IN ('accepted', 'rejected', 'deferred') OR "decidedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "ChangeRequest_projectId_seq_key" ON "ChangeRequest"("projectId", "seq");
CREATE INDEX "ChangeRequest_projectId_status_idx" ON "ChangeRequest"("projectId", "status");
CREATE INDEX "ChangeRequest_baseCalculationId_idx" ON "ChangeRequest"("baseCalculationId");

CREATE TABLE "ChangeRequestEvent" (
 "id" TEXT NOT NULL,
 "crId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "actor" TEXT NOT NULL,
 "comment" TEXT,
 "data" JSONB,
 "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ChangeRequestEvent_pkey" PRIMARY KEY ("id"),
 CHECK ("action" IN ('created', 'updated', 'submitted', 'estimated', 'accepted', 'rejected', 'deferred', 'reopened')),
 CHECK (length("actor") BETWEEN 1 AND 200),
 CONSTRAINT "ChangeRequestEvent_crId_fkey" FOREIGN KEY ("crId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChangeRequestEvent_crId_at_idx" ON "ChangeRequestEvent"("crId", "at");

-- Журнал только дополняется: правка записи истории запрещена на уровне СУБД.
-- Удаление остаётся возможным лишь каскадом вместе с самим запросом.
CREATE FUNCTION "ChangeRequestEvent_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ChangeRequestEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ChangeRequestEvent_no_update"
  BEFORE UPDATE ON "ChangeRequestEvent"
  FOR EACH ROW EXECUTE FUNCTION "ChangeRequestEvent_append_only"();
