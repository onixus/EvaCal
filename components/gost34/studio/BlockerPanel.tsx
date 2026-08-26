'use client';

import { getWizardStep } from '@/lib/gost34/wizard/steps';
import type { WizardIssue } from '@/lib/gost34/wizard/types';

interface BlockerPanelProps {
  issues: WizardIssue[];
  isOpen: boolean;
  onToggle: () => void;
  onGoToIssue: (issue: WizardIssue) => void;
  isLoading: boolean;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Читаемый источник замечания: «Шаг 5 · Реквизиты и подписи → поле „Утвердил"».
 *
 * Номер и название шага берутся из реестра шагов, а не из самого замечания:
 * иначе переименование шага пришлось бы повторять в каждом правиле движка.
 */
function describeSource(issue: WizardIssue): string {
  const step = getWizardStep(issue.stepId);
  const base = `Шаг ${step.order} · ${step.title}`;
  return issue.fieldLabel ? `${base} → ${issue.fieldLabel}` : base;
}

/**
 * Сводная панель над контентом студии: сколько блокеров мешает выпуску, откуда
 * каждый взялся и как до него дойти.
 *
 * Панель показывается и когда блокеров нет, но есть предупреждения — иначе
 * незакрытые вопросы (UNKNOWN-нормативы, непокрытые требования) были бы видны
 * только на последнем шаге, куда пользователь доходит уже перед выпуском.
 */
export default function BlockerPanel({
  issues,
  isOpen,
  onToggle,
  onGoToIssue,
  isLoading,
}: BlockerPanelProps) {
  const blockers = issues.filter((i) => i.severity === 'blocker');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 dark:border-nord-green/40 dark:bg-nord-green/10">
        <span className="status-dot bg-emerald-500 dark:bg-nord-green" />
        <span className="text-xs font-bold text-emerald-800 dark:text-nord-green">
          {isLoading ? 'Идёт проверка комплекта…' : 'Замечаний нет — комплект готов к выпуску'}
        </span>
      </div>
    );
  }

  const hasBlockers = blockers.length > 0;

  return (
    <div
      className={
        hasBlockers
          ? 'blocker-panel'
          : 'rounded-[10px] border border-amber-200 bg-amber-50/70 dark:border-nord-yellow/40 dark:bg-nord-yellow/10'
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={`status-dot ${
              hasBlockers ? 'bg-rose-500 dark:bg-nord-red' : 'bg-amber-500 dark:bg-nord-yellow'
            }`}
          />
          <span
            className={`text-xs font-extrabold ${
              hasBlockers
                ? 'text-rose-800 dark:text-nord-redText'
                : 'text-amber-800 dark:text-nord-yellow'
            }`}
          >
            {hasBlockers ? 'Выпуск заблокирован' : 'Выпуск возможен, есть замечания'}
          </span>
          <span className="nums text-[11px] font-semibold text-slate-500 dark:text-nord-muted">
            {hasBlockers &&
              `${blockers.length} ${pluralRu(blockers.length, 'блокер', 'блокера', 'блокеров')}`}
            {hasBlockers && warnings.length > 0 && ' · '}
            {warnings.length > 0 &&
              `${warnings.length} ${pluralRu(warnings.length, 'предупреждение', 'предупреждения', 'предупреждений')} (не блокируют)`}
          </span>
        </span>

        <span className="shrink-0 text-[11px] font-bold text-slate-500 dark:text-nord-muted">
          {isOpen ? 'Свернуть' : 'Показать'}
        </span>
      </button>

      {isOpen && (
        <div className="space-y-1.5 px-3.5 pb-3.5">
          {issues.map((issue, idx) => (
            <div
              key={`${issue.ruleId ?? 'rule'}-${issue.fieldRef ?? idx}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 dark:border-nord-3 dark:bg-nord-2"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={issue.severity === 'blocker' ? 'chip-block' : 'chip-warn'}>
                    {issue.severity === 'blocker' ? 'блокер' : 'предупреждение'}
                  </span>
                  <span className="text-xs font-semibold text-slate-900 dark:text-nord-6">
                    {issue.text}
                  </span>
                </div>
                <div className="text-[11px] leading-relaxed text-slate-500 dark:text-nord-muted">
                  Источник:{' '}
                  <span className="font-semibold text-slate-700 dark:text-nord-4">
                    {describeSource(issue)}
                  </span>
                  {issue.ruleLabel && <> · Правило: {issue.ruleLabel}</>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onGoToIssue(issue)}
                className="btn-secondary shrink-0 !px-2.5 !py-1 !text-[11px] !font-bold"
              >
                Перейти к полю →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
