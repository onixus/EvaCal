'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Gost34RequirementItem } from '@/lib/gost34/types';
import {
  listTorTemplates,
  applyTorTemplate,
  type TorTemplateCategory,
  type Gost34TorTemplate,
} from '@/lib/gost34/torTemplates';

interface TorTemplatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  currentRequirements: Gost34RequirementItem[];
  onApplyTemplate: (nextRequirements: Gost34RequirementItem[]) => void;
}

const CATEGORY_TABS: { id: 'all' | TorTemplateCategory; label: string; icon: string }[] = [
  { id: 'all', label: 'Все шаблоны', icon: '📂' },
  { id: 'development', label: 'Веб и микросервисы', icon: '🌐' },
  { id: 'enterprise', label: 'ERP / CRM', icon: '🏢' },
  { id: 'fintech', label: 'Финтех и Банки', icon: '💳' },
  { id: 'compliance', label: 'ГИС и КИИ (ФСТЭК)', icon: '🏛️' },
  { id: 'data_bi', label: 'DWH и Аналитика', icon: '📊' },
  { id: 'security', label: 'ИБ и SOC', icon: '🛡️' },
  { id: 'infrastructure', label: 'Инфраструктура и ПАК', icon: '🖥️' },
];

const REQ_CATEGORY_LABELS: Record<string, { label: string; style: string }> = {
  functional: {
    label: 'Функциональные',
    style:
      'bg-blue-50 text-blue-800 border-blue-200 dark:bg-nord-frost2/15 dark:text-nord-frost2 dark:border-nord-frost2/40',
  },
  reliability: {
    label: 'Надёжность',
    style:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-nord-green/15 dark:text-nord-green dark:border-nord-green/40',
  },
  security: {
    label: 'Безопасность',
    style:
      'bg-amber-50 text-amber-900 border-amber-300 dark:bg-nord-yellow/15 dark:text-nord-yellow dark:border-nord-yellow/40',
  },
  performance: {
    label: 'Производительность',
    style:
      'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/40',
  },
  ergonomics: {
    label: 'Эргономика / UI',
    style:
      'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/40',
  },
  maintenance: {
    label: 'Эксплуатация',
    style:
      'bg-slate-100 text-slate-700 border-slate-300 dark:bg-nord-3 dark:text-nord-4 dark:border-nord-3',
  },
  integration: {
    label: 'Интеграция',
    style:
      'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/40',
  },
};

export default function TorTemplatePicker({
  isOpen,
  onClose,
  currentRequirements,
  onApplyTemplate,
}: TorTemplatePickerProps) {
  const allTemplates = useMemo(() => listTorTemplates(), []);
  const [selectedCategoryId, setSelectedCategoryId] = useState<'all' | TorTemplateCategory>('all');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(allTemplates[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [applyMode, setApplyMode] = useState<'replace' | 'append'>('replace');

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return allTemplates.filter((tmpl) => {
      const matchCategory = selectedCategoryId === 'all' || tmpl.category === selectedCategoryId;
      if (!matchCategory) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        tmpl.name.toLowerCase().includes(q) ||
        tmpl.description.toLowerCase().includes(q) ||
        tmpl.systemType.toLowerCase().includes(q) ||
        tmpl.categoryLabel.toLowerCase().includes(q)
      );
    });
  }, [allTemplates, selectedCategoryId, searchQuery]);

  // Selected template object
  const selectedTemplate: Gost34TorTemplate | undefined = useMemo(() => {
    return (
      allTemplates.find((t) => t.id === selectedTemplateId) ||
      filteredTemplates[0] ||
      allTemplates[0]
    );
  }, [allTemplates, selectedTemplateId, filteredTemplates]);

  if (!isOpen) return null;

  const handleApply = () => {
    if (!selectedTemplate) return;
    const nextReqs = applyTorTemplate({
      template: selectedTemplate,
      currentRequirements,
      mode: applyMode,
    });
    onApplyTemplate(nextReqs);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tor-template-picker-title"
    >
      <div className="bg-white dark:bg-nord-0 border border-slate-200 dark:border-nord-3 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-nord-3 flex items-center justify-between bg-slate-50/80 dark:bg-nord-1/80">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-xl">📋</span>
              <h3
                id="tor-template-picker-title"
                className="text-lg font-bold text-slate-900 dark:text-nord-6"
              >
                Библиотека отраслевых шаблонов ТЗ по ГОСТ 34.602
              </h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300 border border-brand-200 dark:border-brand-500/40">
                {allTemplates.length} готовых профилей
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-nord-4 mt-0.5">
              Каждый шаблон содержит готовые измеримые требования к системе (раздел 4 ТЗ),
              сформулированные строго по канонам ГОСТ 34.602 и прошедшие автовалидацию.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-nord-6 hover:bg-slate-200 dark:hover:bg-nord-3 transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Categories Bar & Search */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-nord-3 bg-white dark:bg-nord-0 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {CATEGORY_TABS.map((tab) => {
              const active = selectedCategoryId === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                    active
                      ? 'bg-brand-600 text-white shadow-sm font-semibold'
                      : 'bg-slate-100 text-slate-700 dark:bg-nord-2 dark:text-nord-4 hover:bg-slate-200 dark:hover:bg-nord-3 hover:text-slate-900 dark:hover:text-nord-6'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Поиск по названию или типу..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-nord-3 bg-slate-50 dark:bg-nord-1 text-slate-900 dark:text-nord-6 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Two-Column Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-nord-3 overflow-hidden">
          {/* Left Column: List of Templates */}
          <div className="w-full md:w-5/12 lg:w-4/12 overflow-y-auto p-4 space-y-2.5 bg-slate-50/50 dark:bg-nord-1/30">
            {filteredTemplates.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-500 dark:text-nord-muted">
                Ничего не найдено по вашему запросу
              </div>
            ) : (
              filteredTemplates.map((template) => {
                const isSelected = selectedTemplate?.id === template.id;
                return (
                  <div
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                      isSelected
                        ? 'border-brand-500 bg-white dark:bg-nord-2 shadow-md ring-1 ring-brand-500'
                        : 'border-slate-200 dark:border-nord-3 bg-white/80 dark:bg-nord-1/60 hover:bg-white dark:hover:bg-nord-2 hover:border-slate-300 dark:hover:border-nord-3'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{template.icon}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-nord-6 leading-snug">
                          {template.name}
                        </h4>
                      </div>
                      <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">
                        {template.requirements.length} треб.
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-nord-4 mt-1.5 line-clamp-2 leading-relaxed">
                      {template.description}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 dark:bg-nord-3 text-slate-700 dark:text-nord-4">
                        {template.categoryLabel}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-50 dark:bg-nord-2 text-blue-700 dark:text-nord-frost2">
                        {template.systemType}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Column: Selected Template Preview */}
          <div className="w-full md:w-7/12 lg:w-8/12 flex-1 flex flex-col min-h-0 bg-white dark:bg-nord-0">
            {selectedTemplate ? (
              <>
                {/* Template Info Banner */}
                <div className="p-5 border-b border-slate-200 dark:border-nord-3 bg-slate-50/50 dark:bg-nord-1/30 shrink-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{selectedTemplate.icon}</span>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-brand-600 dark:text-nord-frost2 tracking-wider">
                          {selectedTemplate.systemType} • {selectedTemplate.categoryLabel}
                        </span>
                        <h4 className="text-base font-bold text-slate-900 dark:text-nord-6">
                          {selectedTemplate.name}
                        </h4>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-brand-50 text-brand-800 border border-brand-200 dark:bg-brand-500/20 dark:text-brand-300 dark:border-brand-500/40">
                        ГОСТ 34.602-2020
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-700 dark:text-nord-4 mt-2 leading-relaxed">
                    {selectedTemplate.description}
                  </p>

                  {selectedTemplate.metadata?.scopeSummary && (
                    <div className="mt-2 text-[11px] text-slate-600 dark:text-nord-muted">
                      <span className="font-semibold text-slate-700 dark:text-nord-5">
                        Область действия и назначение:{' '}
                      </span>
                      {selectedTemplate.metadata.scopeSummary}
                    </div>
                  )}

                  {/* Category Counters */}
                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-nord-3">
                    {Object.entries(
                      selectedTemplate.requirements.reduce<Record<string, number>>((acc, r) => {
                        acc[r.category] = (acc[r.category] || 0) + 1;
                        return acc;
                      }, {}),
                    ).map(([catKey, count]) => {
                      const cfg = REQ_CATEGORY_LABELS[catKey] || {
                        label: catKey,
                        style: 'bg-slate-100 text-slate-700 border-slate-200',
                      };
                      return (
                        <span
                          key={catKey}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${cfg.style}`}
                        >
                          {cfg.label}: {count}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Requirements List */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  <div className="text-xs font-bold text-slate-700 dark:text-nord-4 uppercase tracking-wider flex items-center justify-between">
                    <span>
                      Состав требований раздела 4 ({selectedTemplate.requirements.length})
                    </span>
                    <span className="text-[10px] normal-case text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1">
                      <span>✓</span> Все требования проверены валидатором
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {selectedTemplate.requirements.map((req, idx) => {
                      const catConfig = REQ_CATEGORY_LABELS[req.category] || {
                        label: req.category,
                        style: 'bg-slate-100 text-slate-700 border-slate-200',
                      };
                      return (
                        <div
                          key={req.id || idx}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-nord-3 bg-slate-50/70 dark:bg-nord-1/50 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold text-brand-700 dark:text-nord-frost2 bg-brand-50 dark:bg-nord-2 px-1.5 py-0.5 rounded border border-brand-200 dark:border-nord-3">
                                {req.code}
                              </span>
                              <span className="text-xs font-bold text-slate-900 dark:text-nord-6">
                                {req.title}
                              </span>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${catConfig.style}`}
                            >
                              {catConfig.label}
                            </span>
                          </div>

                          <p className="text-xs text-slate-700 dark:text-nord-4 leading-relaxed font-normal">
                            {req.description}
                          </p>

                          {req.criterion && (
                            <div className="pt-1 text-[11px] text-slate-600 dark:text-nord-muted flex items-start gap-1.5">
                              <span className="font-semibold text-slate-700 dark:text-nord-5 shrink-0">
                                Критерий проверки:
                              </span>
                              <span>{req.criterion}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-xs text-slate-500 dark:text-nord-muted">
                Выберите шаблон из списка слева для предпросмотра
              </div>
            )}
          </div>
        </div>

        {/* Footer with Apply Action */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-nord-3 bg-slate-50/90 dark:bg-nord-1/90 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Mode Selector */}
          {currentRequirements.length > 0 ? (
            <div className="flex items-center gap-4 text-xs">
              <span className="font-semibold text-slate-700 dark:text-nord-5">Режим:</span>
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-800 dark:text-nord-5">
                <input
                  type="radio"
                  name="applyMode"
                  value="replace"
                  checked={applyMode === 'replace'}
                  onChange={() => setApplyMode('replace')}
                  className="text-brand-600 focus:ring-brand-500"
                />
                <span>Заменить текущие ({currentRequirements.length})</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-800 dark:text-nord-5">
                <input
                  type="radio"
                  name="applyMode"
                  value="append"
                  checked={applyMode === 'append'}
                  onChange={() => setApplyMode('append')}
                  className="text-brand-600 focus:ring-brand-500"
                />
                <span>
                  Добавить к текущим ({currentRequirements.length} +{' '}
                  {selectedTemplate?.requirements.length || 0})
                </span>
              </label>
            </div>
          ) : (
            <div className="text-xs text-slate-600 dark:text-nord-4">
              Требования шаблона сформируют раздел 4 «Требования к системе» ГОСТ 34.
            </div>
          )}

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-nord-3 text-slate-700 dark:text-nord-4 hover:bg-slate-100 dark:hover:bg-nord-2 transition-colors cursor-pointer"
            >
              Отмена
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={!selectedTemplate}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-md shadow-brand-600/30 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              <span>Применить шаблон</span>
              {selectedTemplate && (
                <span className="px-1.5 py-0.5 rounded-full bg-brand-700 text-white text-[10px]">
                  {selectedTemplate.requirements.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
