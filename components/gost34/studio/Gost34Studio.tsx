'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { GostDocumentType, Gost34RequirementItem } from '@/lib/gost34/types';
import type { ApplicabilityOverride } from '@/lib/gost34/applicability/types';
import type { TraceLink } from '@/lib/gost34/traceability/types';
import type { WizardIssue, WizardReviewResult, WizardStepId } from '@/lib/gost34/wizard/types';
import { WIZARD_STEPS, adjacentWizardStep } from '@/lib/gost34/wizard/steps';
import { CURRENT_GOST34_PROFILE_ID } from '@/lib/gost34/standards';
import { LAYOUT_PROFILES, DEFAULT_LAYOUT_PROFILE } from '@/lib/gost34/exporters/layout';
import type { LayoutProfileId } from '@/lib/gost34/exporters/layout';
import { withShareHeaders } from '@/lib/shareClient';
import { STEP_STATUS_STYLES, fieldAnchorId } from '../wizardShared';
import BlockerPanel from './BlockerPanel';
import ProfileStep from '../steps/ProfileStep';
import RequirementsStep from '../steps/RequirementsStep';
import ApplicabilityStep from '../steps/ApplicabilityStep';
import TraceabilityStep from '../steps/TraceabilityStep';
import SignaturesStep from '../steps/SignaturesStep';
import DocumentPreviewStep from '../steps/DocumentPreviewStep';
import ComplianceStep from '../steps/ComplianceStep';

const DEFAULT_SIGNATURES: Record<string, string> = {
  developer: 'Иванов А.В.',
  checker: 'Петров С.Н.',
  normControl: 'Васильева Е.И.',
  approver: 'Михайлов Д.П.',
  customerApprover: 'Александров И.В.',
};

type SectionOverrides = Record<string, { title?: string; paragraphs?: string[]; items?: string[] }>;

interface Gost34StudioProps {
  calculationId: string;
  calculationName: string;
  customerName: string;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Студия ГОСТ 34 — полноэкранная замена модального «Мастера выпуска».
 *
 * Модал был тёмным островом посреди светлого приложения и прятал контекст:
 * закрыть его, чтобы свериться с расчётом, значило потерять место в мастере.
 * Студия — обычный экран: остаётся адресуемой ссылкой, живёт в общей теме и
 * держит сводку блокеров всегда на виду, а не только на последнем шаге.
 */
export default function Gost34Studio({
  calculationId,
  calculationName,
  customerName,
}: Gost34StudioProps) {
  const [activeStep, setActiveStep] = useState<WizardStepId>('profile');
  const [blockersOpen, setBlockersOpen] = useState(true);

  // Решения пользователя
  const [standardProfileId, setStandardProfileId] = useState<string>(CURRENT_GOST34_PROFILE_ID);
  const [layoutProfileId, setLayoutProfileId] = useState<LayoutProfileId>(
    DEFAULT_LAYOUT_PROFILE.id,
  );
  const [docType, setDocType] = useState<GostDocumentType>('TZ');
  const [requirements, setRequirements] = useState<Gost34RequirementItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [applicabilityOverrides, setApplicabilityOverrides] = useState<
    Record<string, ApplicabilityOverride>
  >({});
  const [manualLinks, setManualLinks] = useState<TraceLink[]>([]);
  const [signatures, setSignatures] = useState<Record<string, string>>(DEFAULT_SIGNATURES);
  const [contractNumber, setContractNumber] = useState('Договор № 01-ГС/2026');
  const [city, setCity] = useState('Москва');
  const [sectionOverrides, setSectionOverrides] = useState<SectionOverrides>({});

  // Результат серверной проверки
  const [review, setReview] = useState<WizardReviewResult | null>(null);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  // Черновик снимка мастера (RR-2)
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<string | null>(null);

  // One-time cleanup: earlier versions kept an API key in localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    for (const key of [
      'gost34_llm_provider',
      'gost34_llm_endpoint',
      'gost34_llm_model',
      'gost34_llm_apikey',
    ]) {
      localStorage.removeItem(key);
    }
  }, []);

  // Автозагрузка сохранённого черновика снимка при открытии студии
  useEffect(() => {
    let cancelled = false;

    async function fetchDraft() {
      setIsDraftLoading(true);
      try {
        const res = await fetch(`/api/calculations/${calculationId}/gost34/draft`, {
          headers: withShareHeaders(calculationId),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.draft?.snapshot) return;

        const snap = data.draft.snapshot;
        if (snap.standardProfileId) setStandardProfileId(snap.standardProfileId);
        if (snap.layoutProfileId) setLayoutProfileId(snap.layoutProfileId);
        if (snap.docType) setDocType(snap.docType);
        if (Array.isArray(snap.requirements) && snap.requirements.length > 0) {
          setRequirements(snap.requirements);
        }
        if (snap.applicabilityOverrides && Object.keys(snap.applicabilityOverrides).length > 0) {
          setApplicabilityOverrides(snap.applicabilityOverrides);
        }
        if (Array.isArray(snap.manualLinks) && snap.manualLinks.length > 0) {
          setManualLinks(snap.manualLinks);
        }
        if (snap.signatures && Object.keys(snap.signatures).length > 0) {
          setSignatures(snap.signatures);
        }
        if (snap.contractNumber) setContractNumber(snap.contractNumber);
        if (snap.city) setCity(snap.city);
        if (snap.sectionOverrides && Object.keys(snap.sectionOverrides).length > 0) {
          setSectionOverrides(snap.sectionOverrides);
        }
        if (snap.activeStep) setActiveStep(snap.activeStep);
        if (data.draft.updatedAt) {
          setLastDraftSavedAt(
            new Date(data.draft.updatedAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          );
        }
      } catch (err) {
        console.error('Failed to load wizard draft snapshot:', err);
      } finally {
        if (!cancelled) setIsDraftLoading(false);
      }
    }

    fetchDraft();
    return () => {
      cancelled = true;
    };
  }, [calculationId]);

  const requirementsKey = JSON.stringify(requirements);
  const overridesKey = JSON.stringify(applicabilityOverrides);
  const manualLinksKey = JSON.stringify(manualLinks);
  const signaturesKey = JSON.stringify(signatures);

  /**
   * Обзор пересчитывается на сервере: движки применимости, валидации и
   * трассировки остаются единственным источником истины и для UI, и для экспорта.
   */
  useEffect(() => {
    let cancelled = false;

    // Обзор устаревает сразу, а не через debounce: пока идёт пересчёт, панель
    // блокеров не должна считать прежний вердикт действующим.
    setIsReviewLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/gost34/review', {
          method: 'POST',
          headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            calculationId,
            rawRequirements: JSON.parse(requirementsKey),
            vendorFiles: uploadedFiles,
            standardProfileId,
            applicabilityOverrides: JSON.parse(overridesKey),
            manualLinks: JSON.parse(manualLinksKey),
            signatures: JSON.parse(signaturesKey),
          }),
        });

        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setReviewError(data?.error || 'Не удалось выполнить проверку комплекта.');
          return;
        }
        setReviewError('');
        setReview(data as WizardReviewResult);
      } catch (err: unknown) {
        if (!cancelled) {
          setReviewError(
            err instanceof Error ? err.message : 'Не удалось выполнить проверку комплекта.',
          );
        }
      } finally {
        if (!cancelled) setIsReviewLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    calculationId,
    standardProfileId,
    requirementsKey,
    overridesKey,
    manualLinksKey,
    signaturesKey,
    uploadedFiles,
  ]);

  const stepStatus = useCallback(
    (id: WizardStepId) =>
      review?.compliance.steps.find((step) => step.id === id)?.status ?? 'empty',
    [review],
  );

  const issues = useMemo(() => review?.compliance.issues ?? [], [review]);
  const blockerCount = issues.filter((i) => i.severity === 'blocker').length;
  const canExport = Boolean(review?.compliance.canExport) && !isReviewLoading && !reviewError;

  /**
   * Переход к источнику замечания: сменить шаг, доскроллить до поля и мигнуть
   * рамкой. Скролл откладывается на кадр — до перерисовки шага якоря в DOM ещё
   * нет, и `getElementById` вернул бы null.
   */
  const pendingAnchor = useRef<string | null>(null);

  const goToIssue = useCallback((issue: WizardIssue) => {
    setActiveStep(issue.stepId);
    pendingAnchor.current = issue.fieldRef ? fieldAnchorId(issue.fieldRef) : null;
    setBlockersOpen(false);
  }, []);

  useEffect(() => {
    const anchorId = pendingAnchor.current;
    if (!anchorId) return;
    pendingAnchor.current = null;

    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(anchorId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('field-flash');
      window.setTimeout(() => el.classList.remove('field-flash'), 2100);
    });

    return () => cancelAnimationFrame(frame);
  }, [activeStep]);

  const exportPayload = useMemo(
    () => ({
      layoutProfileId,
      standardProfileId,
      contractNumber,
      city,
      enrich: true,
      /** Флаги обогащения выводятся из применимости, а не из отдельных чекбоксов. */
      enrichmentOptions: review?.applicability.options,
      applicabilityOverrides,
      ...signatures,
      rawRequirements: requirements,
      /** Подтверждённые связи печатаются в матрице прослеживаемости документа. */
      manualLinks,
      sectionOverrides,
    }),
    [
      layoutProfileId,
      standardProfileId,
      contractNumber,
      city,
      review,
      applicabilityOverrides,
      signatures,
      requirements,
      manualLinks,
      sectionOverrides,
    ],
  );

  /**
   * Удаление требования снимает и его решение по трассировке: иначе связь
   * осталась бы висеть на несуществующем требовании и искажала покрытие.
   */
  const handleRequirementsChange = (next: Gost34RequirementItem[]) => {
    const keptIds = new Set(next.map((req) => req.id));
    const removedIds = new Set(requirements.map((req) => req.id).filter((id) => !keptIds.has(id)));

    setRequirements(next);
    if (removedIds.size > 0) {
      setManualLinks((prev) => prev.filter((link) => !removedIds.has(link.sourceId)));
    }
  };

  /** Запись в лист внутренних изменений — побочный эффект, не блокирующий действие. */
  const recordChange = useCallback(
    async (docRef: string, text: string, source: string) => {
      try {
        await fetch(`/api/calculations/${calculationId}/changelog`, {
          method: 'POST',
          headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ docRef, text, source }),
        });
      } catch (err) {
        console.error('Не удалось записать строку листа изменений:', err);
      }
    },
    [calculationId],
  );

  /**
   * Правка раздела в предпросмотре попадает в лист изменений. Сравниваем с
   * прежним состоянием, чтобы отличить правку от сброса и не писать строку на
   * каждый повторный сейв без изменений.
   */
  const handleSectionOverrides = (next: SectionOverrides) => {
    const prevTitles = new Set(Object.keys(sectionOverrides));
    const nextTitles = new Set(Object.keys(next));

    for (const title of nextTitles) {
      const changed = JSON.stringify(sectionOverrides[title]) !== JSON.stringify(next[title]);
      if (changed) {
        recordChange(
          `${docType} · ${title}`,
          prevTitles.has(title)
            ? `Раздел «${title}» отредактирован вручную в студии.`
            : `Раздел «${title}» изменён вручную: текст заменён авторской редакцией.`,
          'studio-inline',
        );
      }
    }

    for (const title of prevTitles) {
      if (!nextTitles.has(title)) {
        recordChange(
          `${docType} · ${title}`,
          `Ручная правка раздела «${title}» отменена, восстановлен сгенерированный текст.`,
          'studio-inline',
        );
      }
    }

    setSectionOverrides(next);
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    try {
      const snapshot = {
        standardProfileId,
        layoutProfileId,
        docType,
        contractNumber,
        city,
        requirements,
        applicabilityOverrides,
        manualLinks,
        signatures,
        sectionOverrides,
        activeStep,
        updatedAt: new Date().toISOString(),
      };

      const res = await fetch(`/api/calculations/${calculationId}/gost34/draft`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ snapshot, standardProfileId }),
      });

      if (res.ok) {
        setLastDraftSavedAt(
          new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        );
      }
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setIsSavingDraft(false);
    }
  };

  const download = async (
    payload: Record<string, unknown>,
    filename: string,
    changeText: string,
  ) => {
    setIsExporting(true);
    setExportError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/gost34`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Ошибка при генерации документа ГОСТ 34');
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      await recordChange('Комплект', changeText, 'release');
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Ошибка сервера');
    } finally {
      setIsExporting(false);
    }
  };

  const activeStepDefinition = WIZARD_STEPS.find((step) => step.id === activeStep)!;
  const prevStep = adjacentWizardStep(activeStep, 'prev');
  const nextStep = adjacentWizardStep(activeStep, 'next');

  return (
    <div className="space-y-3">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
            Студия ГОСТ 34 — {calculationName}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
            {docType} · {review ? review.profile.name : 'профиль загружается'} ·{' '}
            {LAYOUT_PROFILES[layoutProfileId].name} · {customerName}
            {lastDraftSavedAt && <> · черновик сохранён в {lastDraftSavedAt}</>}
            {isDraftLoading && <> · загрузка черновика…</>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/calculations/${calculationId}/changelog`}
            className="btn-ghost !px-2.5 !py-1.5 !text-xs"
          >
            Лист изменений
          </Link>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft}
            className="btn-secondary !text-xs"
            title="Сохранить текущие требования и решения студии"
          >
            {isSavingDraft ? 'Сохранение…' : 'Сохранить черновик'}
          </button>
          <button
            type="button"
            onClick={() => setActiveStep('compliance')}
            disabled={!canExport}
            title={
              canExport
                ? undefined
                : `Устраните ${blockerCount} ${pluralRu(blockerCount, 'блокер', 'блокера', 'блокеров')}`
            }
            className="btn-primary !text-xs"
          >
            Выпустить комплект
          </button>
        </div>
      </div>

      <BlockerPanel
        issues={issues}
        isOpen={blockersOpen}
        onToggle={() => setBlockersOpen((v) => !v)}
        onGoToIssue={goToIssue}
        isLoading={isReviewLoading}
      />

      <div className="grid gap-3 lg:grid-cols-[236px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-[calc(var(--app-header-h)+1rem)] lg:self-start">
          <nav className="card-flat space-y-0.5 p-2">
            {WIZARD_STEPS.map((step) => {
              const isActive = activeStep === step.id;
              const status = stepStatus(step.id);
              const style = STEP_STATUS_STYLES[status];

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStep(step.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-nord-3 dark:text-nord-frost2'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-nord-4 dark:hover:bg-nord-3'
                  }`}
                >
                  <span className={`status-dot ${style.dot}`} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[11px] font-bold">
                      {step.order}. {step.title}
                    </span>
                    <span className={`mt-0.5 text-[10px] font-semibold ${style.text}`}>
                      {style.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="min-w-0 space-y-3">
          {activeStep === 'profile' && (
            <ProfileStep
              calculationId={calculationId}
              standardProfileId={standardProfileId}
              layoutProfileId={layoutProfileId}
              docType={docType}
              onStandardProfileChange={setStandardProfileId}
              onLayoutProfileChange={setLayoutProfileId}
              onDocTypeChange={setDocType}
            />
          )}

          {activeStep === 'requirements' && (
            <RequirementsStep
              requirements={requirements}
              onRequirementsChange={handleRequirementsChange}
              uploadedFiles={uploadedFiles}
              onUploadedFilesChange={setUploadedFiles}
              review={review}
              isReviewLoading={isReviewLoading}
            />
          )}

          {activeStep === 'applicability' && (
            <ApplicabilityStep
              review={review}
              isReviewLoading={isReviewLoading}
              overrides={applicabilityOverrides}
              onOverridesChange={setApplicabilityOverrides}
              confirmedBy={signatures.approver || ''}
            />
          )}

          {activeStep === 'traceability' && (
            <TraceabilityStep
              review={review}
              isReviewLoading={isReviewLoading}
              manualLinks={manualLinks}
              onManualLinksChange={setManualLinks}
            />
          )}

          {activeStep === 'signatures' && (
            <SignaturesStep
              signatures={signatures}
              onSignatureChange={(key, value) =>
                setSignatures((prev) => ({ ...prev, [key]: value }))
              }
              contractNumber={contractNumber}
              onContractNumberChange={setContractNumber}
              city={city}
              onCityChange={setCity}
            />
          )}

          {activeStep === 'preview' && (
            <DocumentPreviewStep
              decisions={{
                standardProfileId,
                layoutProfileId,
                docType,
                rawRequirements: requirements,
                applicabilityOverrides,
                manualLinks,
                signatures,
                sectionOverrides,
              }}
              calculationId={calculationId}
              review={review}
              isReviewLoading={isReviewLoading}
              reviewError={reviewError}
              onUpdateSectionOverrides={handleSectionOverrides}
            />
          )}

          {activeStep === 'compliance' && (
            <ComplianceStep
              review={review}
              isReviewLoading={isReviewLoading}
              reviewError={reviewError}
              docType={docType}
              layoutProfileName={LAYOUT_PROFILES[layoutProfileId].name}
              requirementCount={requirements.length}
              isExporting={isExporting}
              exportError={exportError}
              onGoToIssue={goToIssue}
              onExportDocument={() =>
                download(
                  { ...exportPayload, docType },
                  `${docType}_GOST34_Document.docx`,
                  `Выпущен документ ${docType} из студии ГОСТ 34 (профиль ${review?.profile.name ?? standardProfileId}).`,
                )
              }
              onExportZip={() =>
                download(
                  { ...exportPayload, docType: 'ZIP', isBatchZip: true },
                  `GOST34_Full_Package_${calculationName.replace(/\s+/g, '_')}.zip`,
                  `Выпущен полный комплект ГОСТ 34 (ZIP) из студии, профиль ${review?.profile.name ?? standardProfileId}.`,
                )
              }
            />
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-nord-3">
            <div className="hidden min-w-0 flex-1 truncate text-[11px] text-slate-400 md:block dark:text-nord-muted">
              {activeStepDefinition.subtitle}
              {isReviewLoading && ' · идёт проверка…'}
            </div>

            <div className="flex items-center gap-2">
              {prevStep && (
                <button
                  type="button"
                  onClick={() => setActiveStep(prevStep)}
                  className="btn-secondary !text-xs"
                >
                  ← Назад
                </button>
              )}
              {nextStep && (
                <button
                  type="button"
                  onClick={() => setActiveStep(nextStep)}
                  className="btn-primary !text-xs"
                >
                  Далее →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
