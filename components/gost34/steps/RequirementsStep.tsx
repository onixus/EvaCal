'use client';

import { useMemo, useState } from 'react';
import type { Gost34RequirementItem } from '@/lib/gost34/types';
import { normalizeRequirementItems } from '@/lib/gost34/parser/requirementSanitizer';
import type { ValidationFinding } from '@/lib/gost34/validation/types';
import type { WizardReviewResult } from '@/lib/gost34/wizard/types';
import { PANEL_CLASS } from '../wizardShared';
import { useLlmProvider } from '../hooks/useLlmProvider';
import VendorDocUpload from './requirements/VendorDocUpload';
import ValidationSummaryPanel from './requirements/ValidationSummaryPanel';
import DerivedRequirementsList from './requirements/DerivedRequirementsList';
import LlmSettingsPanel from './requirements/LlmSettingsPanel';
import RequirementsTable from './requirements/RequirementsTable';
import ManualRequirementForm from './requirements/ManualRequirementForm';
import TorTemplatePicker from './requirements/TorTemplatePicker';

interface RequirementsStepProps {
  requirements: Gost34RequirementItem[];
  onRequirementsChange: (next: Gost34RequirementItem[]) => void;
  uploadedFiles: string[];
  onUploadedFilesChange: (next: string[]) => void;
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
}

export default function RequirementsStep({
  requirements,
  onRequirementsChange,
  uploadedFiles,
  onUploadedFilesChange,
  review,
  isReviewLoading,
}: RequirementsStepProps) {
  const {
    showLlmSettings,
    setShowLlmSettings,
    llmProviders,
    llmProviderId,
    setLlmProviderId,
    llmSelectedModel,
    setLlmSelectedModel,
    llmAvailable,
    llmModels,
    llmError,
    isLlmNormalizing,
    checkLlmStatus,
    normalizeWithLlm,
  } = useLlmProvider();

  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);

  const handleLlmNormalize = async () => {
    const normalized = await normalizeWithLlm(requirements);
    if (normalized) {
      onRequirementsChange(normalized);
    }
  };

  const handleAddManualRequirement = (newReq: Gost34RequirementItem) => {
    onRequirementsChange([...requirements, newReq]);
  };

  const handleDeleteRequirement = (id: string) => {
    onRequirementsChange(requirements.filter((r) => r.id !== id));
  };

  /** Замечания валидатора, привязанные к коду требования */
  const findingsByCode = useMemo(() => {
    const map = new Map<string, ValidationFinding[]>();
    for (const finding of review?.validation.findings || []) {
      const key = finding.requirementCode || '';
      map.set(key, [...(map.get(key) || []), finding]);
    }
    return map;
  }, [review?.validation.findings]);

  /** Требования, выведенные из этапов расчёта */
  const derivedRequirements = useMemo(() => {
    const ownRequirementCodes = new Set(requirements.map((req) => req.code));
    return (review?.requirements || []).filter((req) => !ownRequirementCodes.has(req.code));
  }, [requirements, review?.requirements]);

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Информационный баннер: архитектурное разделение требований и этапов внедрения */}
      <div className="rounded-xl border border-blue-200 dark:border-nord-10/40 bg-blue-50/70 dark:bg-nord-10/10 p-3.5 text-xs text-blue-950 dark:text-nord-frost2 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <span className="text-lg shrink-0">ℹ️</span>
          <div className="space-y-1">
            <div className="font-bold text-slate-900 dark:text-nord-6">
              Требования к системе (Раздел 4 ТЗ по ГОСТ 34.602)
            </div>
            <div className="text-slate-700 dark:text-nord-4 leading-relaxed">
              Этапы внедрения из расчёта стоимости проекта (исследования, разработка, пусконаладка) —
              это интеграторская работа. Она формирует раздел 6 ТЗ («Состав и содержание работ») и
              матрицу трассируемости. Требования к самой системе (функционал, надёжность, ИБ)
              загружаются из ТЗ вендора, берутся из библиотеки отраслевых шаблонов либо добавляются вручную.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsTemplatePickerOpen(true)}
          className="shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-all flex items-center gap-1.5 cursor-pointer ml-auto"
        >
          <span>📋</span>
          <span>Выбрать шаблон ТЗ (ГОСТ 34)</span>
        </button>
      </div>

      {/* Загрузка исходных спецификаций */}
      <VendorDocUpload
        uploadedFiles={uploadedFiles}
        onUploadedFilesChange={onUploadedFilesChange}
        requirements={requirements}
        onRequirementsChange={onRequirementsChange}
      />

      {/* Сводка валидатора ГОСТ 34 */}
      <ValidationSummaryPanel review={review} isReviewLoading={isReviewLoading} />

      {/* Требования, выведенные из этапов расчёта */}
      <DerivedRequirementsList
        derivedRequirements={derivedRequirements}
        findingsByCode={findingsByCode}
      />

      {/* Таблица извлечённых требований и действия */}
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-slate-200 dark:border-nord-3 pb-3 gap-3">
          <div>
            <h4 className="text-sm font-bold text-brand-700 dark:text-nord-frost2 uppercase tracking-wider">
              Извлечённые требования ({requirements.length})
            </h4>
            <p className="text-xs text-slate-600 dark:text-nord-4 mt-0.5">
              Нормализация не перезаписывает исходный текст: он хранится вместе с требованием
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTemplatePickerOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300 border border-brand-300 dark:border-brand-500/40 hover:bg-brand-100 dark:hover:bg-brand-500/30 transition-colors cursor-pointer flex items-center gap-1.5"
              title="Открыть библиотеку детальных отраслевых шаблонов ТЗ"
            >
              <span>📋</span>
              <span>Шаблоны ТЗ</span>
            </button>

            {requirements.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onRequirementsChange(normalizeRequirementItems(requirements))}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-nord-3 text-slate-800 dark:text-nord-5 border border-slate-300 dark:border-nord-3 hover:bg-slate-200 dark:hover:bg-nord-3 transition-colors cursor-pointer"
                  title="Удалить спецсимволы, буллеты и присвоить стандартные коды ГОСТ 34"
                >
                  🧹 Очистить (правила)
                </button>

                <button
                  type="button"
                  onClick={handleLlmNormalize}
                  disabled={isLlmNormalizing}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    llmAvailable
                      ? 'bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-nord-6 shadow-md shadow-purple-600/30 border border-purple-400/40'
                      : 'bg-slate-100 dark:bg-nord-3 text-slate-500 dark:text-nord-muted border border-slate-300 dark:border-nord-3 hover:bg-slate-200 dark:hover:bg-nord-3'
                  }`}
                  title={
                    llmAvailable
                      ? 'ИИ предлагает нормализованную формулировку; оригинал остаётся неизменным'
                      : 'ИИ-сервер недоступен — проверьте настройки подключения'
                  }
                >
                  <span>
                    {isLlmNormalizing ? '⏳ Идёт обработка ИИ...' : '🤖 ИИ-предложения по тексту'}
                  </span>
                  {llmAvailable && !isLlmNormalizing && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowLlmSettings(!showLlmSettings)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-nord-3 text-slate-600 dark:text-nord-4 border border-slate-300 dark:border-nord-3 hover:text-slate-900 dark:text-nord-6 hover:bg-slate-200 dark:hover:bg-nord-3 transition-colors cursor-pointer"
                >
                  ⚙️ Настройки ИИ
                </button>

                <button
                  type="button"
                  onClick={() => onRequirementsChange([])}
                  className="text-xs font-bold text-rose-700 dark:text-nord-redText hover:text-rose-700 dark:text-nord-redText hover:underline px-2 py-1 cursor-pointer"
                >
                  Очистить список
                </button>
              </>
            )}
          </div>
        </div>

        {showLlmSettings && (
          <LlmSettingsPanel
            llmAvailable={llmAvailable}
            llmError={llmError}
            llmProviders={llmProviders}
            llmProviderId={llmProviderId}
            setLlmProviderId={setLlmProviderId}
            llmModels={llmModels}
            llmSelectedModel={llmSelectedModel}
            setLlmSelectedModel={setLlmSelectedModel}
            onCheckStatus={() => checkLlmStatus()}
          />
        )}

        <RequirementsTable
          requirements={requirements}
          onDeleteRequirement={handleDeleteRequirement}
          findingsByCode={findingsByCode}
        />

        <ManualRequirementForm
          requirementsCount={requirements.length}
          onAddRequirement={handleAddManualRequirement}
        />
      </div>

      {/* Модальное окно выбора готового отраслевого шаблона ТЗ */}
      <TorTemplatePicker
        isOpen={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        currentRequirements={requirements}
        onApplyTemplate={onRequirementsChange}
      />
    </div>
  );
}
