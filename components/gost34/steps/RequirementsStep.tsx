'use client';

import { useMemo } from 'react';
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
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-[#3b4252] pb-3 gap-3">
          <div>
            <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
              Извлечённые требования ({requirements.length})
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              Нормализация не перезаписывает исходный текст: он хранится вместе с требованием
            </p>
          </div>

          {requirements.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRequirementsChange(normalizeRequirementItems(requirements))}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#2e3440] text-slate-200 border border-[#434c5e] hover:bg-[#3b4252] transition-colors cursor-pointer"
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
                    ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 border border-purple-400/40'
                    : 'bg-[#2e3440] text-slate-400 border border-[#434c5e] hover:bg-[#3b4252]'
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
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#2e3440] text-slate-300 border border-[#434c5e] hover:text-white hover:bg-[#3b4252] transition-colors cursor-pointer"
              >
                ⚙️ Настройки ИИ
              </button>

              <button
                type="button"
                onClick={() => onRequirementsChange([])}
                className="text-xs font-bold text-red-400 hover:text-red-300 hover:underline px-2 py-1 cursor-pointer"
              >
                Очистить список
              </button>
            </div>
          )}
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
    </div>
  );
}
