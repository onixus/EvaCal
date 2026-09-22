'use client';

import { DEFAULT_SIGNATURES } from '@/lib/gost34/metadataDefaults';
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
import { TZ_AUTHOR_PROMPT_VERSION, type TzAuthorState } from '@/lib/gost34/llm/tzAuthor/types';
import { STEP_STATUS_STYLES, fieldAnchorId } from '../wizardShared';
import BlockerPanel from './BlockerPanel';
import ProfileStep from '../steps/ProfileStep';
import RequirementsStep from '../steps/RequirementsStep';
import ApplicabilityStep from '../steps/ApplicabilityStep';
import TraceabilityStep from '../steps/TraceabilityStep';
import SignaturesStep from '../steps/SignaturesStep';
import DocumentPreviewStep from '../steps/DocumentPreviewStep';
import ComplianceStep from '../steps/ComplianceStep';
import {
  REVIEW_STAGE_LABELS,
  type ChecklistItem,
  type ReviewStage,
  type SectionComment,
} from '@/lib/gost34/review/types';

export interface StudioLatestPackage {
  id: string;
  version: number;
  name: string;
  status: string;
  reviewStage: ReviewStage;
  reviewComment: string | null;
  reviewComments: SectionComment[];
  reviewChecklist: ChecklistItem[];
  twVersion: {
    name: string;
    uploadedAt: string | null;
    uploadedBy: string | null;
    isPriority: boolean;
  } | null;
  releasedAt: string | null;
  updatedAt: string;
}

const SCHEMA_ISSUE_LABELS: Record<string, string> = {
  missing: 'отсутствует',
  empty: 'без данных',
  'out-of-order': 'нарушен порядок',
};

/** Разбор ответа 409 gost34_invalid_structure в текст для панели ошибок. */
function formatSchemaIssues(issues: unknown): string {
  if (!Array.isArray(issues) || issues.length === 0) {
    return 'Сервер не вернул перечень разделов.';
  }

  const listed = issues
    .slice(0, 5)
    .map(
      (issue: any) =>
        `«${issue?.title ?? issue?.nodeId}» — ${SCHEMA_ISSUE_LABELS[issue?.kind] ?? issue?.kind}`,
    )
    .join('; ');
  const rest = issues.length > 5 ? ` и ещё ${issues.length - 5}` : '';

  return `Разделы: ${listed}${rest}.`;
}

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
  const [contractNumber, setContractNumber] = useState('');
  const [city, setCity] = useState('');
  const [sectionOverrides, setSectionOverrides] = useState<SectionOverrides>({});
  const [tzAuthor, setTzAuthor] = useState<TzAuthorState>({
    promptVersion: TZ_AUTHOR_PROMPT_VERSION,
    speculateDefault: false,
    proposals: {},
  });

  // Результат серверной проверки
  const [review, setReview] = useState<WizardReviewResult | null>(null);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  // Черновик снимка мастера (RR-2) и статус ревью
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<string | null>(null);
  const [latestPackage, setLatestPackage] = useState<StudioLatestPackage | null>(null);
  const [selectedSectionAnchor, setSelectedSectionAnchor] = useState<string | null>(null);
  const [isRejectionBannerDismissed, setIsRejectionBannerDismissed] = useState(false);

  const goToSection = useCallback((sectionTitle: string) => {
    setActiveStep('preview');
    setSelectedSectionAnchor(sectionTitle);
  }, []);

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
        if (cancelled) return;

        if (data?.latestPackage) {
          setLatestPackage(data.latestPackage);
        }

        if (!data?.draft?.snapshot) return;

        const snap = data.draft.snapshot;
        if (snap.standardProfileId) setStandardProfileId(snap.standardProfileId);
        if (snap.layoutProfileId) setLayoutProfileId(snap.layoutProfileId);
        if (snap.docType) setDocType(snap.docType);
        if (Array.isArray(snap.uploadedFiles)) setUploadedFiles(snap.uploadedFiles);
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
        if (snap.tzAuthor && snap.tzAuthor.proposals) {
          setTzAuthor(snap.tzAuthor);
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
  const tzAuthorKey = JSON.stringify(tzAuthor);

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
            tzAuthor: JSON.parse(tzAuthorKey),
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
    tzAuthorKey,
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
      vendorFiles: uploadedFiles,
      /** Подтверждённые связи печатаются в матрице прослеживаемости документа. */
      manualLinks,
      sectionOverrides,
      tzAuthor,
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
      uploadedFiles,
      manualLinks,
      sectionOverrides,
      tzAuthor,
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
        uploadedFiles,
        applicabilityOverrides,
        manualLinks,
        signatures,
        sectionOverrides,
        tzAuthor,
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
        if (res.status === 409 && data?.error === 'tz_author_hard_flags') {
          const details = Array.isArray(data.nodes)
            ? data.nodes
                .map((n: any) => `${n.nodeId} [${n.flagCodes?.join(', ') || ''}]`)
                .join(', ')
            : '';
          throw new Error(
            `Экспорт заблокирован: критические замечания в принятых черновиках ТЗ (${details})`,
          );
        }
        // Проверка структуры отдаёт готовый разбор по разделам — показываем его,
        // а не код ошибки: иначе непонятно, что именно править в документе.
        if (res.status === 409 && data?.error === 'gost34_invalid_structure') {
          throw new Error(
            `Экспорт заблокирован: итоговая структура ТЗ не соответствует профилю. ${formatSchemaIssues(
              data.issues,
            )}`,
          );
        }
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

      {/* Баннер замечаний ревьюера при отклонении комплекта */}
      {latestPackage?.status === 'rejected' && !isRejectionBannerDismissed && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 shadow-sm dark:border-nord-red/40 dark:bg-nord-red/15 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white dark:bg-nord-red">
                !
              </span>
              <div>
                <h3 className="text-sm font-extrabold text-rose-950 dark:text-nord-redText">
                  Предыдущий выпуск (Комплект v{latestPackage.version}) отклонён с замечаниями
                </h3>
                <p className="text-[11px] text-rose-800/80 dark:text-nord-redText/80">
                  Этап:{' '}
                  <span className="font-semibold">
                    {REVIEW_STAGE_LABELS[latestPackage.reviewStage] || latestPackage.reviewStage}
                  </span>
                  {latestPackage.releasedAt && (
                    <>
                      {' '}
                      · Выпущен: {new Date(latestPackage.releasedAt).toLocaleDateString('ru-RU')}
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/review/${latestPackage.id}`}
                className="btn-ghost !border-rose-200 !text-rose-800 hover:!bg-rose-100 !px-2.5 !py-1 !text-xs dark:!border-nord-red/30 dark:!text-nord-redText"
              >
                📋 Лист ревью
              </Link>
              <button
                type="button"
                onClick={() => setIsRejectionBannerDismissed(true)}
                className="text-xs font-semibold text-rose-600 hover:text-rose-800 dark:text-nord-redText/70 dark:hover:text-nord-redText px-1.5 py-0.5"
              >
                Свернуть
              </button>
            </div>
          </div>

          {/* Комментарий вердикта ревьювера */}
          {latestPackage.reviewComment && (
            <div className="rounded-lg border-l-4 border-rose-600 bg-white p-3 shadow-xs dark:bg-nord-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-nord-redText">
                Замечание ревьюера к комплекту
              </div>
              <div className="mt-1 text-xs font-medium italic leading-relaxed text-slate-900 dark:text-nord-6">
                «{latestPackage.reviewComment}»
              </div>
            </div>
          )}

          {/* Замечания по разделам */}
          {latestPackage.reviewComments && latestPackage.reviewComments.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-rose-200/80 bg-white/90 p-3 dark:border-nord-3 dark:bg-nord-2">
              <div className="text-xs font-bold text-slate-900 dark:text-nord-6">
                Замечания к разделам документа ({latestPackage.reviewComments.length}):
              </div>
              <div className="divide-y divide-slate-100 dark:divide-nord-3">
                {latestPackage.reviewComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            comment.severity === 'blocker'
                              ? 'chip-block'
                              : comment.severity === 'remark'
                                ? 'chip-warn'
                                : 'chip-muted'
                          }
                        >
                          {comment.severity === 'blocker'
                            ? 'блокер'
                            : comment.severity === 'remark'
                              ? 'замечание'
                              : 'предложение'}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-nord-6">
                          {comment.sectionId}
                        </span>
                        {comment.author && (
                          <span className="text-[10px] text-slate-400 dark:text-nord-muted">
                            ({comment.author})
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-700 dark:text-nord-4 pl-0.5">
                        {comment.text}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => goToSection(comment.sectionId)}
                      className="btn-secondary shrink-0 !px-2.5 !py-1 !text-[11px] !font-bold self-start sm:self-auto"
                    >
                      ✏️ Исправить раздел →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Версия тех.писателя (если приложена) */}
          {latestPackage.twVersion && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs dark:bg-nord-green/15">
              <span className="text-emerald-900 dark:text-nord-green font-medium">
                📄 Тех.писатель приложил версию с правками:{' '}
                <span className="font-bold">{latestPackage.twVersion.name}</span>
              </span>
              <a
                href={`/api/gost34/packages/${latestPackage.id}/tw-version`}
                download
                className="btn-secondary !text-[11px] !py-0.5 !px-2"
              >
                ⬇ Скачать DOCX
              </a>
            </div>
          )}
        </div>
      )}

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

              const hasReviewRemarks =
                latestPackage?.status === 'rejected' &&
                ((step.id === 'preview' && (latestPackage.reviewComments?.length ?? 0) > 0) ||
                  (step.id === 'requirements' &&
                    latestPackage.reviewChecklist?.some(
                      (c) => c.id === 'requirement-modality' && c.state !== 'ok',
                    )));

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
                  <span
                    className={`status-dot ${
                      hasReviewRemarks
                        ? 'bg-rose-500 ring-2 ring-rose-300 dark:bg-nord-red'
                        : style.dot
                    }`}
                  />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[11px] font-bold flex items-center gap-1.5">
                      <span>
                        {step.order}. {step.title}
                      </span>
                      {hasReviewRemarks && (
                        <span className="chip-block !text-[9px] !px-1 !py-0">замечания</span>
                      )}
                    </span>
                    <span
                      className={`mt-0.5 text-[10px] font-semibold ${
                        hasReviewRemarks ? 'text-rose-600 dark:text-nord-redText' : style.text
                      }`}
                    >
                      {hasReviewRemarks ? 'Требуются правки' : style.label}
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
                contractNumber,
                city,
                vendorFiles: uploadedFiles,
                enrichmentOptions: review?.applicability.options,
                standardProfileId,
                layoutProfileId,
                docType,
                rawRequirements: requirements,
                applicabilityOverrides,
                manualLinks,
                signatures,
                sectionOverrides,
                tzAuthor,
              }}
              calculationId={calculationId}
              review={review}
              isReviewLoading={isReviewLoading}
              reviewError={reviewError}
              onUpdateSectionOverrides={handleSectionOverrides}
              onUpdateTzAuthor={setTzAuthor}
              reviewComments={
                latestPackage?.status === 'rejected' ? latestPackage.reviewComments : undefined
              }
              selectedSectionAnchor={selectedSectionAnchor}
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
