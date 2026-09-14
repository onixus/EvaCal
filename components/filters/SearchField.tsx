'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryFilters } from './useQueryFilters';

/**
 * Поиск по списку: пишет параметр в URL с задержкой, без кнопки «Найти».
 * Enter применяет сразу, крестик очищает.
 */
export default function SearchField({
  param = 'search',
  placeholder = 'Поиск…',
  className = '',
}: {
  param?: string;
  placeholder?: string;
  className?: string;
}) {
  const { get, set, pending } = useQueryFilters();
  const applied = get(param) ?? '';
  const [value, setValue] = useState(applied);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Внешняя смена адреса (сброс, «назад») подтягивает поле к URL.
  useEffect(() => setValue(applied), [applied]);

  function apply(next: string) {
    if (timer.current) clearTimeout(timer.current);
    if (next.trim() !== applied) set({ [param]: next.trim() || null });
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), 400);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400"
      >
        ⌕
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply(value);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-busy={pending || undefined}
        className="input pl-7 pr-7"
      />
      {value && (
        <button
          type="button"
          aria-label="Очистить поиск"
          onClick={() => {
            setValue('');
            apply('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-nord-4"
        >
          ✕
        </button>
      )}
    </div>
  );
}
