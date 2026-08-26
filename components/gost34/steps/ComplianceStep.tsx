'use client';

import { WIZARD_STEPS } from '@/lib/gost34/wizard/steps';
import type { WizardIssue, WizardReviewResult, WizardStepId } from '@/lib/gost34/wizard/types';
import { PANEL_CLASS, STEP_STATUS_STYLES } from '../wizardShared';

interface ComplianceStepProps {
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
  reviewError: string;
  docType: string;
  layoutProfileName: string;
  requirementCount: number;
  isExporting: boolean;
  exportError: string;
  onGoToIssue: (issue: WizardIssue) => void;
  onExportDocument: () => void;
  onExportZip: () => void;
}

export default function ComplianceStep({
  review,
  isReviewLoading,
  reviewError,
  docType,
  layoutProfileName,
  requirementCount,
  isExporting,
  exportError,
  onGoToIssue,
  onExportDocument,
  onExportZip,
}: ComplianceStepProps) {
  const compliance = review?.compliance;
  const canExport = Boolean(compliance?.canExport) && !isReviewLoading && !reviewError;

  return (
    <div className="animate-in fade-in space-y-4 duration-150">
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-3 md:flex-row md:items-center dark:border-nord-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-nord-6">
              Соответствие и выпуск
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-nord-muted">
              Каждая проверка указывает шаг и поле-источник. Предупреждения не блокируют выпуск.
            </p>
          </div>

          {compliance && (
            <span className={compliance.canExport ? 'chip-ok' : 'chip-block'}>
              {compliance.canExport ? 'Готово к выпуску' : 'Выпуск заблокирован'}
            </span>
          )}
        </div>

        {reviewError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-nord-red/40 dark:bg-nord-red/10 dark:text-nord-redText">
            {reviewError}
          </div>
        )}

        {isReviewLoading && (
          <div className="text-xs text-slate-500 dark:text-nord-muted">
            Идёт проверка комплекта…
          </div>
        )}

        <div className="space-y-1.5">
          {WIZARD_STEPS.filter((step) => step.id !== 'compliance').map((step) => {
            const report = compliance?.steps.find((s) => s.id === step.id);
            const style = STEP_STATUS_STYLES[report?.status || 'empty'];
            // Кнопка «Исправить» ведёт к самому серьёзному замечанию шага —
            // блокеры уже отсортированы вперёд движком соответствия.
            const primaryIssue = report?.issues[0];

            return (
              <div
                key={step.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 dark:border-nord-3"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={`status-dot mt-1 ${style.dot}`} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-nord-6">
                      {step.order}. {step.title}
                    </div>
                    {report && report.issues.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {report.issues.map((issue, idx) => (
                          <li
                            key={idx}
                            className="text-[11px] leading-relaxed text-slate-600 dark:text-nord-4"
                          >
                            {issue.text}
                            {issue.fieldLabel && (
                              <span className="text-slate-400 dark:text-nord-muted">
                                {' '}
                                — источник: шаг {step.order}, {issue.fieldLabel}
                              </span>
                            )}
                            {issue.severity === 'warning' && (
                              <span className="text-slate-400 dark:text-nord-muted">
                                {' '}
                                (не блокирует)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className={`mt-0.5 text-[11px] ${style.text}`}>{step.subtitle}</div>
                    )}
                  </div>
                </div>

                {primaryIssue && (
                  <button
                    type="button"
                    onClick={() => onGoToIssue(primaryIssue)}
                    className="btn-secondary shrink-0 !px-2.5 !py-1 !text-[11px] !font-bold"
                  >
                    Исправить →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`${PANEL_CLASS} flex flex-col items-start justify-between gap-4 md:flex-row md:items-center`}
      >
        <div className="w-full space-y-1.5 text-xs md:w-auto">
          <div className="font-bold text-slate-900 dark:text-nord-6">Сводка выпуска</div>
          <div className="leading-relaxed text-slate-600 dark:text-nord-4">
            Профиль{' '}
            <strong className="font-bold text-brand-700 dark:text-nord-frost2">
              {review ? `${review.profile.name} (${review.profile.version})` : '—'}
            </strong>{' '}
            · документ <strong className="font-bold">{docType}</strong> · оформление{' '}
            <strong className="font-bold">{layoutProfileName}</strong> ·{' '}
            <span className="nums">{requirementCount}</span> требований ·{' '}
            <span className="nums">{review ? review.applicability.summary.applicable : 0}</span>{' '}
            применимых нормативов
            {review && review.applicability.summary.unknown > 0 && (
              <span className="text-amber-700 dark:text-nord-yellow">
                {' '}
                (не подтверждено: {review.applicability.summary.unknown})
              </span>
            )}
          </div>
          {/*
            Поле оглавления намеренно не помечается требующим обновления —
            иначе Word при открытии файла спрашивает про внешние связи.
            Номера страниц подставляются при обновлении поля.
          */}
          <div className="pt-1 text-[11px] leading-relaxed text-slate-400 dark:text-nord-muted">
            Содержание в выгруженном DOCX уже содержит перечень разделов, но без номеров страниц:
            откройте файл в Word и обновите поле (выделить всё → F9).
          </div>
          {exportError && (
            <div className="pt-1 text-[11px] text-rose-600 dark:text-nord-redText">
              {exportError}
            </div>
          )}
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row md:w-auto">
          <button
            type="button"
            onClick={onExportDocument}
            disabled={!canExport || isExporting}
            title={canExport ? undefined : 'Устраните блокирующие замечания на предыдущих шагах'}
            className="btn-primary !text-xs"
          >
            {isExporting ? 'Формирование…' : `${docType} (.docx)`}
          </button>

          <button
            type="button"
            onClick={onExportZip}
            disabled={!canExport || isExporting}
            title={canExport ? undefined : 'Устраните блокирующие замечания на предыдущих шагах'}
            className="btn bg-emerald-600 !text-xs text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Весь комплект (ZIP)
          </button>
        </div>
      </div>
    </div>
  );
}
