-- #103 WP-7a: библиотека проектных решений — версионируемые наборы
-- «требования + работы + риски + проверки + фрагменты документов».
-- Перечисления хранятся как TEXT + CHECK (см. 20261010110000_commercial_pricing_mode).
-- Правила и роли — docs/solution-library.md, схема содержимого — lib/solutionKits/content.ts.

CREATE TABLE "SolutionKit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolutionKit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SolutionKit_status_check" CHECK ("status" IN ('draft', 'approved', 'archived')),
    -- Ключ совпадает с KIT_KEY_PATTERN в lib/solutionKits/content.ts.
    CONSTRAINT "SolutionKit_key_check" CHECK ("key" ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
    CONSTRAINT "SolutionKit_name_check" CHECK (btrim("name") <> ''),
    CONSTRAINT "SolutionKit_scope_check" CHECK (jsonb_typeof("scope") = 'object')
);

CREATE TABLE "SolutionKitVersion" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" JSONB NOT NULL,
    "changelog" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SolutionKitVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SolutionKitVersion_status_check" CHECK ("status" IN ('draft', 'approved', 'archived')),
    CONSTRAINT "SolutionKitVersion_version_check" CHECK ("version" >= 1),
    CONSTRAINT "SolutionKitVersion_content_check" CHECK (jsonb_typeof("content") = 'object'),
    -- Черновик не утверждён; утверждённая и архивная версии несут подпись.
    CONSTRAINT "SolutionKitVersion_approval_check" CHECK (
        ("status" = 'draft' AND "approvedBy" IS NULL AND "approvedAt" IS NULL) OR
        ("status" <> 'draft' AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL)
    ),
    CONSTRAINT "SolutionKitVersion_archive_check" CHECK (
        ("status" = 'archived') = ("archivedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "SolutionKit_key_key" ON "SolutionKit"("key");
CREATE INDEX "SolutionKit_status_name_idx" ON "SolutionKit"("status", "name");
CREATE UNIQUE INDEX "SolutionKitVersion_kitId_version_key" ON "SolutionKitVersion"("kitId", "version");
CREATE INDEX "SolutionKitVersion_kitId_status_idx" ON "SolutionKitVersion"("kitId", "status");
-- Не больше одного черновика на набор.
CREATE UNIQUE INDEX "SolutionKitVersion_one_draft_key" ON "SolutionKitVersion"("kitId") WHERE "status" = 'draft';

ALTER TABLE "SolutionKitVersion" ADD CONSTRAINT "SolutionKitVersion_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "SolutionKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Утверждённая версия неизменна: проекты (следующий шаг #103) ссылаются на
-- {kitId, version, elementId}, и содержимое под ссылкой не должно меняться.
-- Разрешён только переход approved → archived без правки содержимого;
-- архивная версия не меняется вовсе. Удалить можно только черновик.
CREATE FUNCTION "solution_kit_version_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'SolutionKitVersion %/v% is %: only drafts can be deleted', OLD."kitId", OLD."version", OLD."status";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'draft' THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'approved'
     AND NEW."status" = 'archived'
     AND NEW."kitId" = OLD."kitId"
     AND NEW."version" = OLD."version"
     AND NEW."content" = OLD."content"
     AND NEW."changelog" = OLD."changelog"
     AND NEW."createdBy" = OLD."createdBy"
     AND NEW."createdAt" = OLD."createdAt"
     AND NEW."approvedBy" IS NOT DISTINCT FROM OLD."approvedBy"
     AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'SolutionKitVersion %/v% is %: approved versions are immutable (only approved -> archived)', OLD."kitId", OLD."version", OLD."status";
END;
$$;

CREATE TRIGGER "SolutionKitVersion_guard"
  BEFORE UPDATE OR DELETE ON "SolutionKitVersion"
  FOR EACH ROW EXECUTE FUNCTION "solution_kit_version_guard"();
