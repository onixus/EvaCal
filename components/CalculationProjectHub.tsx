'use client';

import { useState } from 'react';
import Link from 'next/link';
import StatusBadge from './StatusBadge';
import StageTable, { StageRow } from './StageTable';
import GanttChart, { GanttStage } from './GanttChart';
import TotalsSummary, { RiskRow } from './TotalsSummary';
import ExportLinks from './ExportLinks';
import Gost34WizardModal from './gost34/Gost34WizardModal';
import CommercialProposalPanel from './CommercialProposalPanel';
import TraceabilityMatrixView from './gost34/TraceabilityMatrixView';
import ScenarioAnalysisPanel from './ScenarioAnalysisPanel';
import SpecificationPanel from './SpecificationPanel';

interface FieldForView {
  id: string;
  label: string;
  key: string;
}

interface CalculationData {
  id: string;
  name: string;
  customer: string;
  status: string;
  startDate: string;
  createdAt: string;
  pmHours: number;
  template: { name: string; fields: FieldForView[] };
  stages: StageRow[];
  risks: RiskRow[];
  answers: Record<string, unknown>;
  currency?: string;
  roleRates?: string | null;
  overheadPercent?: number;
  marginPercent?: number;
  discountPercent?: number;
  vatPercent?: number;
  includeVat?: boolean;
}

export default function CalculationProjectHub({ calculation }: { calculation: CalculationData }) {
  const [activeTab, setActiveTab] = useState<
    'summary' | 'commercial' | 'scenarios' | 'schedule' | 'traceability' | 'specification' | 'gost34'
  >('summary');
  const [isGostModalOpen, setIsGostModalOpen] = useState(false);

  const startDateFormatted = new Date(calculation.startDate).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const createdDateFormatted = new Date(calculation.createdAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });

  const totalStageHours = calculation.stages
    .filter((s) => !s.isApprovalTask)
    .reduce((sum, s) => sum + s.hours, 0);

  const grandTotal =
    totalStageHours + calculation.pmHours + calculation.risks.reduce((sum, r) => sum + r.hours, 0);

  return (
    <div className="space-y-6">
      {/* Project Hero Bar */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-5 dark:border-nord-3 dark:from-nord-1/40 dark:to-nord-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-nord-6">
                  {calculation.name}
                </h1>
                <StatusBadge status={calculation.status} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                <span>
                  Заказчик:{' '}
                  <strong className="font-semibold text-slate-700 dark:text-nord-4">
                    {calculation.customer}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Шаблон:{' '}
                  <strong className="font-semibold text-slate-700 dark:text-nord-4">
                    {calculation.template.name}
                  </strong>
                </span>
                <span>•</span>
                <span>Старт: {startDateFormatted}</span>
                <span>•</span>
                <span>Создан: {createdDateFormatted}</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/architect/${calculation.id}`}
                className="btn-secondary !py-1.5 !px-3 text-xs font-semibold"
                title="Перейти к редактированию этапов и рисков"
              >
                🛠️ Архитектор
              </Link>
              <Link
                href={`/presale/${calculation.id}`}
                className="btn-secondary !py-1.5 !px-3 text-xs font-semibold"
                title="Открыть опросник пресейла"
              >
                📝 Пресейл
              </Link>
              <ExportLinks
                calculationId={calculation.id}
                calculationName={calculation.name}
                customerName={calculation.customer}
              />
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200/80 bg-white px-6 dark:border-nord-3 dark:bg-nord-2">
          <button
            onClick={() => setActiveTab('summary')}
            className={`tab-btn ${activeTab === 'summary' ? 'tab-btn-active' : ''}`}
          >
            <span>📊 Сводка и опросник</span>
          </button>
          <button
            onClick={() => setActiveTab('commercial')}
            className={`tab-btn ${activeTab === 'commercial' ? 'tab-btn-active' : ''}`}
          >
            <span>💰 Смета и КП</span>
            {calculation.marginPercent !== undefined && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-700 dark:bg-nord-frost3/20 dark:text-nord-frost3">
                {calculation.marginPercent}%
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('scenarios')}
            className={`tab-btn ${activeTab === 'scenarios' ? 'tab-btn-active' : ''}`}
          >
            <span>📈 Сценарии</span>
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`tab-btn ${activeTab === 'schedule' ? 'tab-btn-active' : ''}`}
          >
            <span>📅 План-график и Гант</span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-600 dark:bg-nord-3 dark:text-nord-4">
              {calculation.stages.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('traceability')}
            className={`tab-btn ${activeTab === 'traceability' ? 'tab-btn-active' : ''}`}
          >
            <span>🔗 Трассируемость</span>
          </button>
          <button
            onClick={() => setActiveTab('specification')}
            className={`tab-btn ${activeTab === 'specification' ? 'tab-btn-active' : ''}`}
          >
            <span>📦 Спецификация ПАК и ПО</span>
          </button>
          <button
            onClick={() => setActiveTab('gost34')}
            className={`tab-btn ${activeTab === 'gost34' ? 'tab-btn-active' : ''}`}
          >
            <span>📑 ГОСТ 34 и документация</span>
          </button>
        </div>
      </div>

      {/* Tab: Commercial Proposal & Costing */}
      {activeTab === 'commercial' && (
        <CommercialProposalPanel
          calculationId={calculation.id}
          stages={calculation.stages}
          pmHours={calculation.pmHours}
          risks={calculation.risks}
          initialCurrency={calculation.currency}
          initialRoleRates={calculation.roleRates}
          initialOverheadPercent={calculation.overheadPercent}
          initialMarginPercent={calculation.marginPercent}
          initialDiscountPercent={calculation.discountPercent}
          initialVatPercent={calculation.vatPercent}
          initialIncludeVat={calculation.includeVat}
        />
      )}

      {/* Tab: Scenario Analysis */}
      {activeTab === 'scenarios' && (
        <ScenarioAnalysisPanel
          calculationId={calculation.id}
          calculationName={calculation.name}
          stages={calculation.stages}
          pmHours={calculation.pmHours}
          risks={calculation.risks}
          currency={calculation.currency}
          roleRates={calculation.roleRates}
          overheadPercent={calculation.overheadPercent}
          marginPercent={calculation.marginPercent}
          discountPercent={calculation.discountPercent}
          vatPercent={calculation.vatPercent}
          includeVat={calculation.includeVat}
        />
      )}

      {/* Tab: Traceability Matrix */}
      {activeTab === 'traceability' && (
        <TraceabilityMatrixView
          stages={calculation.stages}
          answers={calculation.answers}
          fields={calculation.template.fields}
        />
      )}

      {/* Tab: Hardware & Software Specification */}
      {activeTab === 'specification' && (
        <SpecificationPanel
          calculationId={calculation.id}
          calculationName={calculation.name}
          customerName={calculation.customer}
          answers={calculation.answers}
          onOpenGostWizard={() => setIsGostModalOpen(true)}
        />
      )}

      {/* Tab 1: Summary */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Executive KPI Banner */}
          <div className="card p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
              Распределение трудозатрат
            </h2>
            <TotalsSummary
              stages={calculation.stages}
              pmHours={calculation.pmHours}
              risks={calculation.risks}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Questionnaire Answers */}
            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900 dark:text-nord-6">Ответы опросника</h2>
                <Link
                  href={`/presale/${calculation.id}`}
                  className="text-xs font-medium text-brand-600 hover:underline dark:text-nord-frost2"
                >
                  Изменить ответы →
                </Link>
              </div>

              {calculation.template.fields.length === 0 ? (
                <p className="text-sm text-slate-500">В шаблоне нет вопросов.</p>
              ) : (
                <dl className="divide-y divide-slate-100 dark:divide-nord-3">
                  {calculation.template.fields.map((field) => {
                    const val = calculation.answers[field.key];
                    const displayVal =
                      typeof val === 'boolean'
                        ? val
                          ? 'Да'
                          : 'Нет'
                        : val !== undefined && val !== null && String(val).trim() !== ''
                          ? String(val)
                          : '—';

                    return (
                      <div key={field.id} className="py-2.5 first:pt-0 last:pb-0">
                        <dt className="text-xs font-medium text-slate-500 dark:text-nord-muted">
                          {field.label}
                        </dt>
                        <dd className="mt-0.5 text-sm font-medium text-slate-800 dark:text-nord-5">
                          {displayVal}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </div>

            {/* Risks Register */}
            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900 dark:text-nord-6">Реестр рисков</h2>
                <Link
                  href={`/architect/${calculation.id}`}
                  className="text-xs font-medium text-brand-600 hover:underline dark:text-nord-frost2"
                >
                  Управление рисками →
                </Link>
              </div>

              {calculation.risks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-nord-3 dark:text-nord-muted">
                  В проекте не зафиксированы дополнительные риски.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {calculation.risks.map((risk) => (
                    <div
                      key={risk.id}
                      className="flex items-center justify-between rounded-lg border border-amber-200/60 bg-amber-50/40 p-3 dark:border-nord-yellow/20 dark:bg-nord-yellow/5"
                    >
                      <div className="text-xs font-medium text-slate-800 dark:text-nord-5">
                        {risk.description}
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-nord-yellow/20 dark:text-nord-yellow">
                        +{risk.hours} ч
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Schedule & Gantt */}
      {activeTab === 'schedule' && (
        <div className="space-y-6">
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-nord-6">
                  Календарный план этапов
                </h2>
                <p className="text-xs text-slate-500 dark:text-nord-muted">
                  Сводная таблица этапов проекта, исполнителей и сроков
                </p>
              </div>
              <Link
                href={`/architect/${calculation.id}`}
                className="btn-secondary !py-1.5 !px-3 text-xs font-semibold"
              >
                Редактировать этапы ✏️
              </Link>
            </div>
            <StageTable stages={calculation.stages} />
          </div>

          <div className="card p-5">
            <div className="mb-4">
              <h2 className="font-semibold text-slate-900 dark:text-nord-6">Диаграмма Ганта</h2>
              <p className="text-xs text-slate-500 dark:text-nord-muted">
                Визуализация сроков, параллельных потоков и контрольных точек согласования
              </p>
            </div>
            <GanttChart stages={calculation.stages as GanttStage[]} />
          </div>
        </div>
      )}

      {/* Tab 3: GOST 34 Documentation */}
      {activeTab === 'gost34' && (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-nord-frost4/20 dark:text-nord-frost2">
                  <span>Стандарт ГОСТ 34.602 / ГОСТ 34.201</span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-nord-6">
                  Комплект проектной документации ГОСТ 34
                </h2>
                <p className="max-w-2xl text-sm text-slate-500 dark:text-nord-muted">
                  Сформируйте техническое задание (ТЗ), пояснительную записку (ПЗ), программу и
                  методику испытаний (ПМИ), архитектурный формуляр (АФ) или частное техническое
                  задание (ЧТЗ) по действующим нормативным профилям.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsGostModalOpen(true)}
                className="btn-primary !py-3 !px-5 text-sm font-semibold shadow-md whitespace-nowrap"
              >
                <span className="text-base">🚀</span>
                <span>Запустить Мастер ГОСТ 34</span>
              </button>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/30">
                <div className="text-lg">📋</div>
                <div className="mt-2 font-semibold text-slate-800 dark:text-nord-5">
                  ТЗ ГОСТ 34.602-2020
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-nord-muted">
                  Полная структура с 9 обязательными разделами, матрицей трассируемости и рамкой
                  ГОСТ 2.301.
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/30">
                <div className="text-lg">🤖</div>
                <div className="mt-2 font-semibold text-slate-800 dark:text-nord-5">
                  ИИ-нормализация требований
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-nord-muted">
                  Автоматическое приведение формулировок из файлов заказчика к критериям измеримости
                  и проверяемости.
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/30">
                <div className="text-lg">⚖️</div>
                <div className="mt-2 font-semibold text-slate-800 dark:text-nord-5">
                  Движок применимости
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-nord-muted">
                  Автоматический учёт 152-ФЗ, 187-ФЗ КИИ, приказов ФСТЭК №17/21 и ГОСТ Р 56939.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Gost34WizardModal
        calculationId={calculation.id}
        calculationName={calculation.name}
        customerName={calculation.customer}
        isOpen={isGostModalOpen}
        onClose={() => setIsGostModalOpen(false)}
      />
    </div>
  );
}
