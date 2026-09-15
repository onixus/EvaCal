'use client';

import { useQueryFilters } from './useQueryFilters';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * Переключатель одного параметра URL: строка чипов, активный — заливкой.
 * Клик применяет фильтр сразу и обновляет данные с сервера; кнопки «Найти»
 * или «Применить» не нужно.
 */
export default function FilterChips({
  param,
  options,
  value,
  defaultValue = '',
  ariaLabel,
}: {
  param: string;
  options: FilterOption[];
  /** Текущее значение; если не передано — читается из URL. */
  value?: string;
  /** Значение, при котором параметр убирается из адреса. */
  defaultValue?: string;
  ariaLabel?: string;
}) {
  const { get, set, pending } = useQueryFilters();
  const current = value ?? get(param) ?? defaultValue;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      className={`flex flex-wrap items-center gap-1.5 transition-opacity ${pending ? 'opacity-60' : ''}`}
    >
      {options.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => set({ [param]: opt.value === defaultValue ? null : opt.value })}
            className={`filter-chip ${active ? 'filter-chip-active' : ''}`}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span
                className={`filter-chip-count ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-500 dark:bg-nord-1 dark:text-nord-muted'}`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
