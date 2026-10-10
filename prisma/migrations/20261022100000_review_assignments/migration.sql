-- #103 WP-3a: персональные назначения на этапы ревью и замечания с жизненным циклом.
-- Перечисления хранятся как TEXT + CHECK (см. 20261010110000_commercial_pricing_mode).

-- CreateTable
CREATE TABLE "ReviewAssignment" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "deputyId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReviewAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',
    "fixedBy" TEXT,
    "fixedAt" TIMESTAMP(3),
    "fixedInPackageId" TEXT,
    "fixedInVersion" INTEGER,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCommentReply" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCommentReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewAssignment_packageId_stage_idx" ON "ReviewAssignment"("packageId", "stage");

-- CreateIndex
CREATE INDEX "ReviewAssignment_assigneeId_active_idx" ON "ReviewAssignment"("assigneeId", "active");

-- CreateIndex
CREATE INDEX "ReviewAssignment_deputyId_active_idx" ON "ReviewAssignment"("deputyId", "active");

-- CreateIndex
CREATE INDEX "ReviewComment_packageId_status_idx" ON "ReviewComment"("packageId", "status");

-- CreateIndex
CREATE INDEX "ReviewComment_fixedInPackageId_idx" ON "ReviewComment"("fixedInPackageId");

-- CreateIndex
CREATE INDEX "ReviewCommentReply_commentId_createdAt_idx" ON "ReviewCommentReply"("commentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "GostPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "GostPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCommentReply" ADD CONSTRAINT "ReviewCommentReply_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ReviewComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Одно активное назначение на пару (комплект, этап). Частичный индекс Prisma
-- описать не умеет, поэтому он живёт только здесь.
CREATE UNIQUE INDEX "ReviewAssignment_active_key" ON "ReviewAssignment"("packageId", "stage") WHERE "active";

ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_stage_check"
  CHECK ("stage" IN ('tw', 'gap'));
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_deputy_check"
  CHECK ("deputyId" IS NULL OR "deputyId" <> "assigneeId");

ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_stage_check"
  CHECK ("stage" IN ('tw', 'gap'));
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_severity_check"
  CHECK ("severity" IN ('blocker', 'remark', 'suggestion'));
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_status_check"
  CHECK ("status" IN ('open', 'fixed', 'verified', 'rejected'));
-- «Исправлено» и «проверено» без ссылки на исправленную версию не бывает.
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_fixed_ref_check"
  CHECK ("status" NOT IN ('fixed', 'verified')
    OR ("fixedInPackageId" IS NOT NULL AND "fixedInVersion" IS NOT NULL AND "fixedAt" IS NOT NULL));
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_verified_check"
  CHECK ("status" <> 'verified' OR ("verifiedBy" IS NOT NULL AND "verifiedAt" IS NOT NULL));

-- Перенос замечаний из JSON GostPackage.reviewComments. Столбец не удаляется:
-- он остаётся резервом только для чтения. Битый JSON пропускается, а не роняет
-- миграцию: старый парсер тоже трактовал его как «замечаний нет».
CREATE FUNCTION pg_temp.evacal_try_jsonb(raw TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN raw::JSONB;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE FUNCTION pg_temp.evacal_try_ts(raw TEXT) RETURNS TIMESTAMP(3) LANGUAGE plpgsql AS $$
BEGIN
  RETURN (raw::TIMESTAMPTZ AT TIME ZONE 'UTC')::TIMESTAMP(3);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

INSERT INTO "ReviewComment" (
  "id", "packageId", "stage", "sectionId", "severity", "text", "author", "createdAt", "status"
)
SELECT
  'rcmig_' || md5(p."id" || ':' || c.ord::TEXT),
  p."id",
  CASE WHEN p."reviewStage" IN ('gap', 'done') THEN 'gap' ELSE 'tw' END,
  left(c.elem->>'sectionId', 200),
  CASE WHEN c.elem->>'severity' IN ('blocker', 'remark', 'suggestion')
    THEN c.elem->>'severity' ELSE 'remark' END,
  left(btrim(c.elem->>'text'), 2000),
  COALESCE(NULLIF(c.elem->>'author', ''), 'reviewer'),
  COALESCE(pg_temp.evacal_try_ts(c.elem->>'createdAt'), p."updatedAt"),
  'open'
FROM "GostPackage" p
CROSS JOIN LATERAL (SELECT pg_temp.evacal_try_jsonb(p."reviewComments") AS doc) j
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(j.doc) = 'array' THEN j.doc ELSE '[]'::JSONB END
) WITH ORDINALITY AS c(elem, ord)
WHERE p."reviewComments" IS NOT NULL
  AND jsonb_typeof(c.elem) = 'object'
  AND COALESCE(c.elem->>'sectionId', '') <> ''
  AND btrim(COALESCE(c.elem->>'text', '')) <> '';
