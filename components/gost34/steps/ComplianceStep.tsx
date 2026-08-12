'use client';

import { WIZARD_STEPS } from '@/lib/gost34/wizard/steps';
import type { WizardReviewResult, WizardStepId } from '@/lib/gost34/wizard/types';
import { PANEL_CLASS, STEP_STATUS_STYLES, SUBPANEL_CLASS } from '../wizardShared';

interface ComplianceStepProps {
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
  reviewError: string;
  docType: string;
  layoutProfileName: string;
  requirementCount: number;
  isExporting: boolean;
  exportError: string;
  onGoToStep: (step: WizardStepId) => void;
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
  onGoToStep,
  onExportDocument,
  onExportZip,
}: ComplianceStepProps) {
  const compliance = review?.compliance;
  const canExport = Boolean(compliance?.canExport) && !isReviewLoading && !reviewError;

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#3b4252] pb-3">
          <div>
            <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
              ✅ Соответствие нормативному профилю
            </h4>
            <p className="text-xs text-slate-300 mt-1">
              Выпуск блокируют только несоответствия: ошибки формулировок, пустая основная надпись и
              незаполненные обязательные сведения о проекте.
            </p>
          </div>

          {compliance && (
            <span
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                compliance.canExport
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'bg-red-500/15 text-red-300 border-red-500/40'
              }`}
            >
              {compliance.canExport ? 'Готово к выпуску' : 'Выпуск заблокирован'}
            </span>
          )}
        </div>

        {reviewError && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {reviewError}
          </div>
        )}

        {isReviewLoading && <div className="text-xs text-slate-400">Идёт проверка комплекта…</div>}

        <div className="space-y-2">
          {WIZARD_STEPS.filter((step) => step.id !== 'compliance').map((step) => {
            const report = compliance?.steps.find((s) => s.id === step.id);
            const style = STEP_STATUS_STYLES[report?.status || 'empty'];

            return (
              <div key={step.id} className={`${SUBPANEL_CLASS} p-3.5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                      <span className="font-bold text-sm text-white">
                        {step.order}. {step.title}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${style.chip}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    {report && report.issues.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {report.issues.map((issue, idx) => (
                          <li key={idx} className="text-[11px] text-slate-300 leading-relaxed">
                            • {issue}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onGoToStep(step.id)}
                    className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#2e3440] text-slate-300 border border-[#434c5e] hover:text-white transition-colors"
                  >
                    Перейти
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`${PANEL_CLASS} flex flex-col md:flex-row items-center justify-between gap-4`}
      >
        <div className="space-y-1.5 text-xs w-full md:w-auto">
          <div className="font-bold text-white">Сводка выпуска:</div>
          <div className="text-slate-300 leading-relaxed">
            • Профиль:{' '}
            <strong className="text-blue-400 font-bold">
              {review ? `${review.profile.name} (${review.profile.version})` : '—'}
            </strong>
            <br />• Документ: <strong className="text-white font-bold">{docType}</strong>
            <br />• Оформление:{' '}
            <strong className="text-white font-bold">{layoutProfileName}</strong>
            <br />• Требований вендора:{' '}
            <strong className="text-white font-bold">{requirementCount}</strong>
            <br />• Применимых нормативов:{' '}
            <strong className="text-white font-bold">
              {review ? review.applicability.summary.applicable : 0}
            </strong>
            {review && review.applicability.summary.unknown > 0 && (
              <span className="text-amber-300">
                {' '}
                (не подтверждено: {review.applicability.summary.unknown})
              </span>
            )}
          </div>
          {exportError && <div className="text-[11px] text-red-300 pt-1">{exportError}</div>}
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <button
            type="button"
            onClick={onExportDocument}
            disabled={!canExport || isExporting}
            title={
              canExport ? undefined : 'Устраните блокирующие замечания на предыдущих шагах мастера'
            }
            className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all border border-blue-400/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isExporting ? 'Формирование…' : `Сформировать ${docType} (.docx)`}
          </button>

          <button
            type="button"
            onClick={onExportZip}
            disabled={!canExport || isExporting}
            className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all border border-emerald-400/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            📦 Скачать весь комплект (ZIP)
          </button>
        </div>
      </div>
    </div>
  );
}
