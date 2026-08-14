'use client';

import { useState, useEffect } from 'react';
import { HEROINES, Heroine } from './heroines/heroinesData';
import { HeroinePortrait } from './heroines/HeroinePortraits';
import { resolveTheme, Theme } from '@/lib/theme';

export default function DarkFantasyCompanion() {
  const [theme, setTheme] = useState<Theme>('light');
  const [activeHeroineId, setActiveHeroineId] = useState<string>('morgana');
  const [quoteIndex, setQuoteIndex] = useState<number>(0);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showRoster, setShowRoster] = useState<boolean>(false);
  const [isHovered, setIsHovered] = useState<boolean>(false);

  useEffect(() => {
    setTheme(resolveTheme());
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: Theme }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
      } else {
        setTheme(resolveTheme());
      }
    };
    window.addEventListener('evacal-theme-change', handler);
    return () => window.removeEventListener('evacal-theme-change', handler);
  }, []);

  const heroine: Heroine = HEROINES.find((h) => h.id === activeHeroineId) || HEROINES[0];

  // Rotate quotes periodically when active
  useEffect(() => {
    if (theme !== 'dark-fantasy') return;
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % heroine.quotes.length);
    }, 12000);
    return () => clearInterval(interval);
  }, [theme, heroine.quotes.length]);

  if (theme !== 'dark-fantasy') {
    return null;
  }

  const nextQuote = () => {
    setQuoteIndex((prev) => (prev + 1) % heroine.quotes.length);
  };

  const selectHeroine = (id: string) => {
    setActiveHeroineId(id);
    setQuoteIndex(0);
    setShowRoster(false);
  };

  return (
    <aside
      aria-label="Фамильяр Тёмного Фэнтези"
      className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 select-none pointer-events-auto"
    >
      {/* Roster Selector Modal / Popover */}
      {showRoster && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Пантеон Дев Тёмного Фэнтези"
          className="mb-2 w-80 rounded-2xl border border-purple-500/40 bg-slate-950/95 p-4 shadow-[0_0_35px_rgba(168,85,247,0.35)] backdrop-blur-xl animate-float-slow text-purple-100"
        >
          <div className="flex items-center justify-between border-b border-purple-800/40 pb-2 mb-3">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🔮</span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-purple-300">
                Пантеон Дев Тёмного Фэнтези
              </h2>
            </div>
            <button
              onClick={() => setShowRoster(false)}
              className="text-xs text-purple-400 hover:text-purple-200 transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {HEROINES.map((h) => {
              const active = h.id === activeHeroineId;
              return (
                <button
                  key={h.id}
                  onClick={() => selectHeroine(h.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-all ${
                    active
                      ? 'border-purple-400 bg-purple-900/40 shadow-[0_0_15px_rgba(192,132,252,0.4)]'
                      : 'border-purple-900/40 bg-slate-900/60 hover:border-purple-600/60 hover:bg-purple-950/40'
                  }`}
                >
                  <div className="relative">
                    <HeroinePortrait heroineId={h.id} size={54} showFrame={false} />
                    {active && (
                      <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-[10px] text-white font-bold">
                        ✓
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-purple-200 leading-tight">
                    {h.name}
                  </span>
                  <span className="text-[10px] text-purple-400 leading-none">
                    {h.role}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Companion Dialogue Card */}
      {isExpanded ? (
        <div
          className="relative max-w-sm rounded-2xl border border-purple-500/30 bg-slate-950/90 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.8),0_0_20px_rgba(168,85,247,0.25)] backdrop-blur-md transition-all hover:border-purple-400/60"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-3 border-b border-purple-900/50 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-purple-950/80 px-2 py-0.5 text-[10px] font-semibold text-purple-300 border border-purple-600/40">
                {heroine.badge}
              </span>
              <span className="text-[11px] font-bold text-purple-200">
                {heroine.name}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-purple-400">
              <button
                onClick={() => setShowRoster(!showRoster)}
                className="rounded px-1.5 py-0.5 text-[10px] hover:bg-purple-900/50 hover:text-purple-200 transition-colors"
                title="Сменить героиню"
              >
                👥 Пантеон
              </button>
              <button
                onClick={() => setIsExpanded(false)}
                className="rounded px-1.5 py-0.5 text-[10px] hover:bg-purple-900/50 hover:text-purple-200 transition-colors"
                title="Свернуть"
              >
                —
              </button>
            </div>
          </div>

          {/* Body: Portrait + Speech */}
          <div className="flex items-start gap-3.5">
            {/* Portrait with Animated Aura */}
            <div
              className="relative shrink-0 cursor-pointer group"
              onClick={() => setShowRoster(!showRoster)}
              title="Нажмите, чтобы сменить героиню"
            >
              <div className="relative rounded-2xl overflow-hidden shadow-[0_0_15px_rgba(168,85,247,0.35)] group-hover:scale-105 transition-transform">
                <HeroinePortrait heroineId={heroine.id} size={74} showFrame={false} />
              </div>
              <span className="absolute -bottom-1.5 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-purple-900 border border-purple-400 text-[10px] shadow-sm">
                {heroine.avatarIcon}
              </span>
            </div>

            {/* Speech Bubble */}
            <div className="flex-1 flex flex-col justify-between">
              <div
                onClick={nextQuote}
                className="cursor-pointer group/quote rounded-xl bg-purple-950/40 border border-purple-800/30 p-2.5 hover:border-purple-600/50 transition-colors"
                title="Нажмите для следующей реплики"
              >
                <p className="text-xs text-purple-100 italic leading-relaxed">
                  {heroine.quotes[quoteIndex]}
                </p>
                <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-purple-400 opacity-60 group-hover/quote:opacity-100">
                  <span>клик для новой реплики</span> ✦
                </div>
              </div>

              {/* Stats Bar */}
              <div className="mt-2.5 flex items-center justify-between text-[10px] text-purple-300 font-mono">
                <span className="opacity-80">{heroine.stats.mana}</span>
                <span className="text-amber-400 font-semibold">{heroine.stats.affinity}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Collapsed Floating Button */
        <button
          onClick={() => setIsExpanded(true)}
          className="group flex items-center gap-2 rounded-full border border-purple-500/50 bg-slate-950/90 py-1.5 pl-2 pr-3.5 shadow-[0_0_20px_rgba(168,85,247,0.4)] backdrop-blur-md hover:border-purple-400 hover:scale-105 transition-all"
        >
          <div className="relative rounded-full overflow-hidden">
            <HeroinePortrait heroineId={heroine.id} size={32} showFrame={false} />
          </div>
          <div className="flex flex-col text-left">
            <span className="text-[11px] font-bold text-purple-200 group-hover:text-white leading-tight">
              {heroine.name}
            </span>
            <span className="text-[9px] text-purple-400 leading-none">
              Тёмная Хранительница
            </span>
          </div>
        </button>
      )}
    </aside>
  );
}
