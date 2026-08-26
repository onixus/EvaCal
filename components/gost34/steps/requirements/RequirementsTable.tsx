'use client';

import { useState } from 'react';
import type { Gost34RequirementItem } from '@/lib/gost34/types';
import type { ValidationFinding } from '@/lib/gost34/validation/types';
import { SUBPANEL_CLASS } from '../../wizardShared';
import { SEVERITY_STYLES } from './ValidationSummaryPanel';

export const CATEGORY_FILTERS = [
  { id: 'all', label: 'Все категории' },
  { id: 'functional', label: 'Функциональные' },
  { id: 'security', label: 'ИБ и безопасность' },
  { id: 'reliability', label: 'Надёжность и SLA' },
  { id: 'technical', label: 'Технические / ПО' },
];

export const CATEGORY_BADGES: Record<string, { label: string; style: string }> = {
  security: { label: 'ИБ', style: 'bg-red-500/20 text-red-300 border-red-500/30' },
  reliability: { label: 'НАД', style: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  technical: { label: 'ТЕХ', style: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  functional: { label: 'ФУНК', style: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
};

interface RequirementsTableProps {
  requirements: Gost34RequirementItem[];
  onDeleteRequirement: (id: string) => void;
  findingsByCode: Map<string, ValidationFinding[]>;
}

export default function RequirementsTable({
  requirements,
  onDeleteRequirement,
  findingsByCode,
}: RequirementsTableProps) {
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filtered = requirements.filter(
    (r) => categoryFilter === 'all' || r.category === categoryFilter,
  );

  return (
    <div className="space-y-3">
      {requirements.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {CATEGORY_FILTERS.map((cat) => {
            const count =
              cat.id === 'all'
                ? requirements.length
                : requirements.filter((r) => r.category === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  categoryFilter === cat.id
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white dark:bg-nord-1 text-slate-600 dark:text-nord-4 hover:bg-slate-50 dark:hover:bg-nord-3 border border-slate-200 dark:border-nord-3'
                }`}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {requirements.length === 0 ? (
        <div className="text-xs text-slate-500 dark:text-nord-muted italic p-6 text-center border border-dashed border-slate-300 dark:border-nord-3 rounded-xl bg-slate-50 dark:bg-nord-1">
          Требования пока не извлечены. Загрузите файл ТЗ (.docx) выше или добавьте пункты вручную.
        </div>
      ) : (
        <div className={`max-h-72 overflow-y-auto ${SUBPANEL_CLASS}`}>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-nord-3 text-slate-900 dark:text-nord-6 sticky top-0 border-b border-slate-300 dark:border-nord-3">
              <tr>
                <th className="p-3 w-32 font-bold text-brand-700 dark:text-nord-frost2">
                  Код ГОСТ
                </th>
                <th className="p-3 w-24 font-bold text-slate-600 dark:text-nord-4">Категория</th>
                <th className="p-3 font-bold text-slate-900 dark:text-nord-6">
                  Формулировка и замечания
                </th>
                <th className="p-3 w-28 font-bold text-slate-600 dark:text-nord-4">Источник</th>
                <th className="p-3 w-12 text-center font-bold text-slate-600 dark:text-nord-4">
                  Удалить
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
              {filtered.map((req) => {
                const findings = findingsByCode.get(req.code) || [];
                const catBadge = CATEGORY_BADGES[req.category] || CATEGORY_BADGES.functional;
                return (
                  <tr
                    key={req.id}
                    className="hover:bg-slate-100 dark:hover:bg-nord-3 transition-colors"
                  >
                    <td className="p-3 font-mono font-bold text-brand-700 dark:text-nord-frost2 align-top">
                      {req.code}
                    </td>
                    <td className="p-3 align-top">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${catBadge.style}`}
                      >
                        {catBadge.label}
                      </span>
                    </td>
                    <td className="p-3 text-slate-900 dark:text-nord-6 break-words align-top space-y-1.5">
                      <div className="font-semibold text-slate-900 dark:text-nord-6">
                        {req.title}
                      </div>
                      {req.title !== req.description && (
                        <div className="text-slate-600 dark:text-nord-4 text-[11px] leading-relaxed">
                          {req.description}
                        </div>
                      )}
                      {findings.map((finding, idx) => (
                        <div
                          key={idx}
                          className={`text-[10px] rounded border px-2 py-1 ${SEVERITY_STYLES[finding.severity]}`}
                        >
                          <span className="font-bold uppercase mr-1">{finding.rule}</span>
                          {finding.message}
                        </div>
                      ))}
                    </td>
                    <td className="p-3 text-slate-500 dark:text-nord-muted text-[11px] align-top space-y-1">
                      <div className="truncate">{req.sourceFile || '—'}</div>
                      {req.normalizedBy && (
                        <div
                          className="inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px]"
                          title={
                            req.originalText
                              ? `Исходная формулировка: ${req.originalText}`
                              : undefined
                          }
                        >
                          ИИ-предложение
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-center align-top">
                      <button
                        type="button"
                        onClick={() => onDeleteRequirement(req.id)}
                        className="text-red-400 hover:text-red-300 font-bold text-sm px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer"
                        title="Удалить требование"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
