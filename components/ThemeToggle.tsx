'use client';

import { useEffect, useState, useRef } from 'react';
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, Theme } from '@/lib/theme';

const THEMES: { id: Theme; label: string; icon: string; desc: string; badge?: string }[] = [
  {
    id: 'light',
    label: 'Светлая',
    icon: '☀️',
    desc: 'Классический интерфейс',
  },
  {
    id: 'dark',
    label: 'Nord Тёмная',
    icon: '🌙',
    desc: 'Скандинавская ночь',
  },
  {
    id: 'dark-fantasy',
    label: 'Тёмное Фэнтези',
    icon: '🔮',
    desc: 'Готика & Аниме-девы',
    badge: 'NEW',
  },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(resolveTheme());
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: Theme }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
      }
    };
    window.addEventListener('evacal-theme-change', handler);
    return () => window.removeEventListener('evacal-theme-change', handler);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectTheme(next: Theme) {
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    setIsOpen(false);
  }

  function cycleTheme() {
    const currentIndex = THEMES.findIndex((t) => t.id === theme);
    const nextTheme = THEMES[(currentIndex + 1) % THEMES.length].id;
    selectTheme(nextTheme);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Выбрать тему интерфейса"
        title={`Текущая тема: ${THEMES.find((t) => t.id === theme)?.label || theme}`}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
          theme === 'dark-fantasy'
            ? 'border border-purple-500/50 bg-purple-950/40 text-purple-200 shadow-[0_0_12px_rgba(168,85,247,0.35)] hover:bg-purple-900/60'
            : theme === 'dark'
            ? 'border border-nord-3 bg-nord-2 text-nord-4 hover:bg-nord-3 hover:text-nord-6'
            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <span className="text-sm">
          {theme === 'dark-fantasy' ? '🔮' : theme === 'dark' ? '🌙' : '☀️'}
        </span>
        <span className="hidden sm:inline">
          {theme === 'dark-fantasy' ? 'Фэнтези' : theme === 'dark' ? 'Nord' : 'Светлая'}
        </span>
        <span className="text-[10px] opacity-60">▼</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl backdrop-blur-lg z-50 dark:border-nord-3 dark:bg-nord-2 dark-fantasy:border-purple-500/40 dark-fantasy:bg-slate-950/95 dark-fantasy:shadow-[0_0_25px_rgba(168,85,247,0.3)]">
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted dark-fantasy:text-purple-400">
            Оформление темы
          </div>

          <div className="space-y-1">
            {THEMES.map((t) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTheme(t.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-all ${
                    active
                      ? t.id === 'dark-fantasy'
                        ? 'bg-purple-900/40 text-purple-200 font-semibold border border-purple-500/40'
                        : 'bg-brand-50 text-brand-700 font-semibold dark:bg-nord-3 dark:text-nord-frost2'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-nord-4 dark:hover:bg-nord-3 dark-fantasy:text-purple-300 dark-fantasy:hover:bg-purple-950/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{t.icon}</span>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="leading-tight">{t.label}</span>
                        {t.badge && (
                          <span className="rounded bg-gradient-to-r from-purple-600 to-pink-600 px-1 py-0.2 text-[9px] font-bold text-white uppercase shadow-sm">
                            {t.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-nord-muted dark-fantasy:text-purple-400/70">
                        {t.desc}
                      </span>
                    </div>
                  </div>

                  {active && (
                    <span className="text-xs font-bold text-brand-600 dark:text-nord-frost2 dark-fantasy:text-purple-300">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
