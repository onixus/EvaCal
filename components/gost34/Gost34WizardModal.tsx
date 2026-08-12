'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GostDocumentType, Gost34RequirementItem } from '@/lib/gost34/types';
import type { ApplicabilityOverride } from '@/lib/gost34/applicability/types';
import type { TraceLink } from '@/lib/gost34/traceability/types';
import type { WizardReviewResult, WizardStepId } from '@/lib/gost34/wizard/types';
import { WIZARD_STEPS, adjacentWizardStep } from '@/lib/gost34/wizard/steps';
import { CURRENT_GOST34_PROFILE_ID } from '@/lib/gost34/standards';
import { LAYOUT_PROFILES, DEFAULT_LAYOUT_PROFILE } from '@/lib/gost34/exporters/layout';
import type { LayoutProfileId } from '@/lib/gost34/exporters/layout';
import { STEP_STATUS_STYLES } from './wizardShared';
import ProfileStep from './steps/ProfileStep';
import RequirementsStep from './steps/RequirementsStep';
import ApplicabilityStep from './steps/ApplicabilityStep';
import TraceabilityStep from './steps/TraceabilityStep';
import SignaturesStep from './steps/SignaturesStep';
import ComplianceStep from './steps/ComplianceStep';

const DEFAULT_SIGNATURES: Record<string, string> = {
  developer: 'Иванов А.В.',
  checker: 'Петров С.Н.',
  normControl: 'Васильева Е.И.',
  approver: 'Михайлов Д.П.',
  customerApprover: 'Александров И.В.',
};

interface Gost34WizardModalProps {
  calculationId: string;
  calculationName?: string;
  customerName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function Gost34WizardModal({
  calculationId,
  calculationName = 'Проект',
  customerName = 'Заказчик',
  isOpen,
  onClose,
}: Gost34WizardModalProps) {
  const [activeStep, setActiveStep] = useState<WizardStepId>('profile');

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

  // Результат серверной проверки
  const [review, setReview] = useState<WizardReviewResult | null>(null);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

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

  const requirementsKey = JSON.stringify(requirements);
  const overridesKey = JSON.stringify(applicabilityOverrides);
  const manualLinksKey = JSON.stringify(manualLinks);
  const signaturesKey = JSON.stringify(signatures);

  /**
   * Обзор пересчитывается на сервере: движки применимости, валидации и
   * трассировки остаются единственным источником истины и для UI, и для экспорта.
   */
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setIsReviewLoading(true);
      try {
        const res = await fetch('/api/gost34/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      } catch (err: any) {
        if (!cancelled) setReviewError(err?.message || 'Не удалось выполнить проверку комплекта.');
      } finally {
        if (!cancelled) setIsReviewLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isOpen,
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
    ],
  );

  const download = async (payload: Record<string, unknown>, filename: string) => {
    setIsExporting(true);
    setExportError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/gost34`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      onClose();
    } catch (err: any) {
      setExportError(err?.message || 'Ошибка сервера');
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  const activeStepDefinition = WIZARD_STEPS.find((step) => step.id === activeStep)!;
  const prevStep = adjacentWizardStep(activeStep, 'prev');
  const nextStep = adjacentWizardStep(activeStep, 'next');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-6xl rounded-2xl bg-[#1a1d24] border border-[#3b4252] p-6 text-slate-100 shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between border-b border-[#2e3440] pb-4 mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-white tracking-wide">
                Мастер выпуска документации ГОСТ 34
              </h3>
              {review && (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-600/30 text-blue-300 border border-blue-400/50">
                  {review.profile.name}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 mt-1">
              Проект: <strong className="text-white font-semibold">{calculationName}</strong> •
              Заказчик: <strong className="text-white font-semibold">{customerName}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white bg-[#2e3440] hover:bg-[#3b4252] text-lg font-bold w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
            title="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-5 border-b border-[#2e3440] pb-4">
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
                className={`p-3 rounded-xl border text-left transition-all ${
                  isActive
                    ? 'bg-blue-600 border-blue-400 text-white font-bold shadow-lg shadow-blue-600/30 ring-1 ring-blue-300'
                    : 'bg-[#242832] border-[#3b4252] text-slate-300 hover:bg-[#2c313d] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                  <span className="font-bold text-[11px] truncate">
                    {step.order}. {step.title}
                  </span>
                </div>
                <div
                  className={`text-[10px] truncate mt-0.5 ${
                    isActive ? 'text-blue-100 font-medium' : 'text-slate-400'
                  }`}
                >
                  {style.label}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto pr-1 min-h-[380px]">
          {activeStep === 'profile' && (
            <ProfileStep
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
              onRequirementsChange={setRequirements}
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
              onGoToStep={setActiveStep}
              onExportDocument={() =>
                download({ ...exportPayload, docType }, `${docType}_GOST34_Document.docx`)
              }
              onExportZip={() =>
                download(
                  { ...exportPayload, docType: 'ZIP', isBatchZip: true },
                  `GOST34_Full_Package_${calculationName.replace(/\s+/g, '_')}.zip`,
                )
              }
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#2e3440] pt-4 mt-4 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-[#2e3440] text-slate-300 hover:text-white hover:bg-[#3b4252] transition-colors"
          >
            Закрыть
          </button>

          <div className="text-[11px] text-slate-400 hidden md:block flex-1 text-center truncate">
            {activeStepDefinition.subtitle}
            {isReviewLoading && ' • идёт проверка…'}
          </div>

          <div className="flex items-center gap-2.5">
            {prevStep && (
              <button
                type="button"
                onClick={() => setActiveStep(prevStep)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#2e3440] text-white hover:bg-[#3b4252] border border-[#434c5e] transition-colors"
              >
                ← Назад
              </button>
            )}

            {nextStep && (
              <button
                type="button"
                onClick={() => setActiveStep(nextStep)}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition-colors"
              >
                Далее →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
