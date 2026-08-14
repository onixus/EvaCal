'use client';

import { useState, useMemo } from 'react';
import {
  buildFullTraceabilityMatrix,
  TraceabilityMatrixItem,
} from '@/lib/gost34/traceability/matrix';
import { getEnrichedGostRequirements } from '@/lib/gost34/enricher';
import { Gost34RequirementItem, Gost34StageItem } from '@/lib/gost34/types';
import { TraceLink } from '@/lib/gost34/traceability/types';
import { StageRow } from '../StageTable';

interface Props {
  stages: StageRow[];
  answers: Record<string, unknown>;
  fields: { key: string; label: string }[];
  customRequirements?: Gost34RequirementItem[];
  manualLinks?: TraceLink[];
  onManualLinksChange?: (links: TraceLink[]) => void;
}

export default function TraceabilityMatrixView({
  stages,
  answers,
  fields,
  customRequirements,
  manualLinks = [],
  onManualLinksChange,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'covered' | 'unmapped'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [localManualLinks, setLocalManualLinks] = useState<TraceLink[]>(manualLinks);

  // Prepare standard + custom requirements
  const allRequirements = useMemo(() => {
    if (customRequirements && customRequirements.length > 0) {
      return customRequirements;
    }
    // Generate enriched requirements from answers
    const hasFz152 = Boolean(answers.fz_152 || answers.security || answers.personal_data);
    const enriched = getEnrichedGostRequirements({
      fz_152: hasFz152,
      fstek_21: hasFz152,
      fstek_117: true,
      sla_999: true,
      wcag_52872: true,
      fz_188_reestr: true,
    });

    // Also extract requirements from stage text
    const stageReqs: Gost34RequirementItem[] = [];
    stages.forEach((s, idx) => {
      if (s.requirements && s.requirements.trim()) {
        stageReqs.push({
          id: `stage-req-${s.id || idx}`,
          code: `ТР-ЭТАП-${idx + 1}`,
          category: 'functional',
          title: `Требования этапа «${s.name}»`,
          description: s.requirements,
        });
      }
    });

    return [...enriched, ...stageReqs];
  }, [customRequirements, answers, stages]);

  const gostStages: Gost34StageItem[] = useMemo(() => {
    return stages
      .filter((s) => !s.isApprovalTask)
      .map((s, idx) => ({
        id: s.id,
        order: idx + 1,
        name: s.name,
        role: s.role,
        hours: s.hours,
        startDate: typeof s.startDate === 'string' ? s.startDate : new Date(s.startDate).toISOString(),
        endDate: typeof s.endDate === 'string' ? s.endDate : new Date(s.endDate).toISOString(),
      }));
  }, [stages]);

  const matrix = useMemo(() => {
    return buildFullTraceabilityMatrix(
      allRequirements,
      gostStages,
      answers,
      fields,
      localManualLinks,
    );
  }, [allRequirements, gostStages, answers, fields, localManualLinks]);

  const filteredItems = useMemo(() => {
    return matrix.items.filter((item) => {
      // Status filter
      if (statusFilter === 'covered' && item.status !== 'covered') return false;
      if (statusFilter === 'unmapped' && item.status !== 'unmapped') return false;

      // Category filter
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = `${item.code} ${item.title} ${item.description} ${item.gostSection.code} ${item.gostSection.title} ${item.pmiTest.testCode} ${item.pmiTest.testTitle} ${item.stage?.name || ''}`.toLowerCase();
        return text.includes(q);
      }

      return true;
    });
  }, [matrix.items, statusFilter, categoryFilter, searchQuery]);

  const handleStageChange = (reqId: string, targetStageId: string) => {
    const nextLinks = localManualLinks.filter((l) => l.sourceId !== reqId);
    if (targetStageId && targetStageId !== 'unmapped') {
      nextLinks.push({
        sourceId: reqId,
        targetId: targetStageId,
        method: 'MANUAL',
        confidence: 1,
        approved: true,
      });
    }

    setLocalManualLinks(nextLinks);
    if (onManualLinksChange) {
      onManualLinksChange(nextLinks);
    }
  };

  return (
    <div className="space-y-6">
      {/* Coverage & Metric Summary Header */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-nord-3 dark:bg-nord-1/60">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Матрица сквозной трассируемости требований (Traceability Matrix)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
              Сквозная прослеживаемость: Опросник пресейла → Требования ТЗ → Разделы ГОСТ 34.602 → Программа испытаний (ПМИ) → Этапы календарного плана
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl font-black text-slate-900 dark:text-nord-6">
                {matrix.metrics.coveragePercent}%
              </div>
              <div className="text-[11px] font-medium text-slate-400 dark:text-nord-muted">
                Покрытие требований
              </div>
            </div>

            <div className="h-10 w-24 overflow-hidden rounded-full bg-slate-100 p-1 dark:bg-nord-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  matrix.metrics.coveragePercent >= 80
                    ? 'bg-emerald-500'
                    : matrix.metrics.coveragePercent >= 50
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                }`}
                style={{ width: `${matrix.metrics.coveragePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Mini stats pills */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs dark:border-nord-3">
          <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700 dark:bg-nord-2 dark:text-nord-4">
            Всего требований: {matrix.metrics.total}
          </span>
          <span className="rounded-md bg-emerald-100 px-2 py-1 font-semibold text-emerald-800 dark:bg-nord-frost3/20 dark:text-nord-frost3">
            ✓ Распределено на этапы: {matrix.metrics.covered}
          </span>
          {matrix.metrics.unmapped > 0 && (
            <span className="rounded-md bg-amber-100 px-2 py-1 font-semibold text-amber-800 dark:bg-nord-yellow/20 dark:text-nord-yellow">
              ⚠ Требуют назначения этапа: {matrix.metrics.unmapped}
            </span>
          )}
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-nord-3 dark:bg-nord-1/60 sm:flex-row sm:items-center sm:justify-between">
        {/* Search input */}
        <div className="relative sm:w-80">
          <input
            type="text"
            placeholder="Поиск по коду, тексту, разделу ТЗ или тесту ПМИ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input w-full text-xs"
          />
        </div>

        {/* Filter buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter buttons */}
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-nord-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-nord-3 dark:text-nord-6'
                  : 'text-slate-500 hover:text-slate-900 dark:text-nord-muted dark:hover:text-nord-4'
              }`}
            >
              Все ({matrix.metrics.total})
            </button>
            <button
              onClick={() => setStatusFilter('covered')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                statusFilter === 'covered'
                  ? 'bg-white text-emerald-700 shadow-sm dark:bg-nord-3 dark:text-nord-frost3'
                  : 'text-slate-500 hover:text-slate-900 dark:text-nord-muted dark:hover:text-nord-4'
              }`}
            >
              Покрытые ({matrix.metrics.covered})
            </button>
            <button
              onClick={() => setStatusFilter('unmapped')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                statusFilter === 'unmapped'
                  ? 'bg-white text-amber-700 shadow-sm dark:bg-nord-3 dark:text-nord-yellow'
                  : 'text-slate-500 hover:text-slate-900 dark:text-nord-muted dark:hover:text-nord-4'
              }`}
            >
              Нераспределенные ({matrix.metrics.unmapped})
            </button>
          </div>

          {/* Category Dropdown */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input text-xs"
          >
            <option value="all">Все категории</option>
            <option value="security">Безопасность (ИБ)</option>
            <option value="integration">Интеграции</option>
            <option value="performance">Производительность</option>
            <option value="reliability">Надежность / SLA</option>
            <option value="functional">Функциональные</option>
            <option value="accessibility">Доступность / Эргономика</option>
          </select>
        </div>
      </div>

      {/* 5-Column Traceability Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-muted">
                <th className="w-48 px-3.5 py-3">1. Опросник / Источник</th>
                <th className="w-72 px-3.5 py-3">2. Требование ТЗ</th>
                <th className="w-56 px-3.5 py-3">3. Раздел ГОСТ 34.602</th>
                <th className="w-64 px-3.5 py-3">4. Методика испытаний (ПМИ)</th>
                <th className="w-56 px-3.5 py-3">5. Этап реализации</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-nord-3/60">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-slate-400 dark:text-nord-muted">
                    Требований, удовлетворяющих условиям фильтрации, не найдено.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className={`transition-colors hover:bg-slate-50/70 dark:hover:bg-nord-2/40 ${
                      item.status === 'unmapped' ? 'bg-amber-50/20 dark:bg-nord-yellow/5' : ''
                    }`}
                  >
                    {/* 1. Questionnaire Source */}
                    <td className="px-3.5 py-3 align-top">
                      {item.sourceQuestion ? (
                        <div className="space-y-1">
                          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-nord-frost2/20 dark:text-nord-frost2">
                            {item.sourceQuestion.fieldKey}
                          </span>
                          <div className="font-medium text-slate-800 dark:text-nord-5">
                            {item.sourceQuestion.label}
                          </div>
                          <div className="text-[11px] font-semibold text-slate-500 dark:text-nord-muted">
                            Ответ: {item.sourceQuestion.answerValue}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-nord-2 dark:text-nord-muted">
                            Нормативный профиль
                          </span>
                          <div className="text-[11px] text-slate-400 dark:text-nord-muted">
                            Обязательный отраслевой стандарт
                          </div>
                        </div>
                      )}
                    </td>

                    {/* 2. Requirement Code & Description */}
                    <td className="px-3.5 py-3 align-top">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-brand-700 dark:text-nord-frost2">
                            {item.code}
                          </span>
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[9px] font-medium text-slate-600 dark:bg-nord-2 dark:text-nord-muted">
                            {item.category}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-nord-6">
                          {item.title}
                        </div>
                        <div className="line-clamp-2 text-[11px] text-slate-500 dark:text-nord-muted">
                          {item.description}
                        </div>
                      </div>
                    </td>

                    {/* 3. GOST 34 Section */}
                    <td className="px-3.5 py-3 align-top">
                      <div className="space-y-1">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 dark:bg-nord-3 dark:text-nord-4">
                          п. {item.gostSection.code} ТЗ
                        </span>
                        <div className="font-medium text-slate-800 dark:text-nord-5">
                          {item.gostSection.title}
                        </div>
                      </div>
                    </td>

                    {/* 4. PMI Verification Test */}
                    <td className="px-3.5 py-3 align-top">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="rounded bg-purple-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-purple-700 dark:bg-nord-purple/20 dark:text-nord-purple">
                            {item.pmiTest.testCode}
                          </span>
                        </div>
                        <div className="font-medium text-slate-800 dark:text-nord-5">
                          {item.pmiTest.testTitle}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-nord-muted">
                          Метод: {item.pmiTest.method}
                        </div>
                      </div>
                    </td>

                    {/* 5. Stage & Assignee Select */}
                    <td className="px-3.5 py-3 align-top">
                      <div className="space-y-1.5">
                        <select
                          value={item.stage?.id || 'unmapped'}
                          onChange={(e) => handleStageChange(item.id, e.target.value)}
                          className={`input h-8 w-full text-xs font-medium ${
                            item.status === 'covered'
                              ? 'border-emerald-300 text-emerald-950 dark:border-nord-frost3/40 dark:text-nord-6'
                              : 'border-amber-300 text-amber-950 dark:border-nord-yellow/40 dark:text-nord-yellow'
                          }`}
                        >
                          <option value="unmapped">[Не распределено]</option>
                          {gostStages.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name} ({st.role})
                            </option>
                          ))}
                        </select>

                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400 dark:text-nord-muted">
                            Способ: {item.mappingMethod}
                          </span>
                          {item.stage && (
                            <span className="font-semibold text-slate-600 dark:text-nord-4">
                              {item.stage.roleLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
