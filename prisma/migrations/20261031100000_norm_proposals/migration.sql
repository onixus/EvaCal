-- #103 WP-6c: предложения изменить норматив этапа шаблона по факту.
-- Утверждение меняет только StageTemplate; расчёты хранят свои этапы копией.
-- Пороги достоверности совпадают с lib/normProposals.ts (docs/norm-proposals.md).

CREATE TABLE "NormProposal" (
    "id" TEXT NOT NULL,
    "stageTemplateId" TEXT NOT NULL,
    "formTemplateId" TEXT NOT NULL,
    "currentStageName" TEXT NOT NULL,
    "currentStageRole" TEXT NOT NULL,
    "currentDriverFieldKey" TEXT,
    "currentBaseHours" DOUBLE PRECISION NOT NULL,
    "currentHoursPerUnit" DOUBLE PRECISION NOT NULL,
    "proposedBaseHours" DOUBLE PRECISION NOT NULL,
    "proposedHoursPerUnit" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "completeness" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "explanation" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,

    CONSTRAINT "NormProposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NormProposal_status_check" CHECK ("status" IN ('proposed', 'approved', 'rejected', 'superseded')),
    CONSTRAINT "NormProposal_confidence_check" CHECK ("confidence" IN ('low', 'medium', 'high')),
    CONSTRAINT "NormProposal_sampleSize_check" CHECK ("sampleSize" >= 1),
    CONSTRAINT "NormProposal_completeness_check" CHECK ("completeness" >= 0 AND "completeness" <= 1),
    -- Малой выборке (меньше MIN_SAMPLES = 3) или неполной (полнота ниже 0.7) — только низкая.
    CONSTRAINT "NormProposal_weak_sample_check" CHECK (
        ("sampleSize" >= 3 AND "completeness" >= 0.7) OR "confidence" = 'low'
    ),
    -- Высокая — только при HIGH_MIN_SAMPLES = 8 полных наблюдений и полноте от 0.9.
    CONSTRAINT "NormProposal_high_confidence_check" CHECK (
        "confidence" <> 'high' OR ("sampleSize" >= 8 AND "completeness" >= 0.9)
    ),
    CONSTRAINT "NormProposal_hours_check" CHECK (
        "currentBaseHours" >= 0 AND "currentHoursPerUnit" >= 0 AND
        "proposedBaseHours" >= 0 AND "proposedHoursPerUnit" >= 0
    ),
    -- Открытое предложение решения не несёт; принятое решение датировано.
    CONSTRAINT "NormProposal_decision_check" CHECK (
        ("status" = 'proposed' AND "decidedAt" IS NULL) OR
        ("status" <> 'proposed' AND "decidedAt" IS NOT NULL)
    )
);

CREATE INDEX "NormProposal_formTemplateId_status_createdAt_idx" ON "NormProposal"("formTemplateId", "status", "createdAt");
CREATE INDEX "NormProposal_stageTemplateId_status_idx" ON "NormProposal"("stageTemplateId", "status");
-- Не больше одного открытого предложения на этап шаблона.
CREATE UNIQUE INDEX "NormProposal_open_key" ON "NormProposal"("stageTemplateId") WHERE "status" = 'proposed';

ALTER TABLE "NormProposal" ADD CONSTRAINT "NormProposal_stageTemplateId_fkey" FOREIGN KEY ("stageTemplateId") REFERENCES "StageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NormProposal" ADD CONSTRAINT "NormProposal_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
