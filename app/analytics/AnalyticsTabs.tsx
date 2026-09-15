'use client';

import { useQueryFilters } from '@/components/filters/useQueryFilters';

export interface AnalyticsTab {
  value: string;
  label: string;
}

/**
 * Вкладки аналитики живут в параметре `tab`: переключение меняет адрес
 * и сразу перечитывает данные с сервера, как и остальные фильтры.
 */
export default function AnalyticsTabs({
  tabs,
  value,
  defaultValue = 'deals',
}: {
  tabs: AnalyticsTab[];
  value: string;
  defaultValue?: string;
}) {
  const { set, pending } = useQueryFilters();
  return (
    <div
      role="tablist"
      aria-label="Разделы аналитики"
      aria-busy={pending || undefined}
      className={`tab-bar transition-opacity ${pending ? 'opacity-60' : ''}`}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            onClick={() => set({ tab: t.value === defaultValue ? null : t.value })}
            className={`tab-btn ${active ? 'tab-btn-active' : ''}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
