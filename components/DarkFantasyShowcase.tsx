/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';
import { resolveTheme, Theme } from '@/lib/theme';
import { HEROINES, Heroine } from './heroines/heroinesData';

export default function DarkFantasyShowcase() {
  const [theme, setTheme] = useState<Theme>('light');
  const [selectedHeroine, setSelectedHeroine] = useState<Heroine>(HEROINES[0]);

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

  if (theme !== 'dark-fantasy') {
    return null;
  }

  return (
    <div className="mb-8 space-y-4">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-purple-500/30 pb-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-900 via-fuchsia-950 to-black border border-purple-400/50 text-lg shadow-[0_0_15px_rgba(168,85,247,0.5)]">
            🔮
          </span>
          <div>
            <h2 className="text-base sm:text-lg font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-purple-100 via-pink-100 to-cyan-200 uppercase font-serif">
              Хранительницы Тёмного Кодекса
            </h2>
            <p className="text-[11px] text-purple-300/80 font-mono">
              Пантеон дев архитектуры, калькуляций, ГОСТ и пресейла
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full bg-purple-950/90 px-3 py-1 text-[11px] font-semibold text-purple-200 border border-purple-500/40 shadow-inner">
            Активная дева:{' '}
            <strong style={{ color: selectedHeroine.themeColor }}>{selectedHeroine.name}</strong>
          </span>
        </div>
      </div>

      {/* 4 Standalone Character Cards in Grok Dark Gothic Style */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {HEROINES.map((h) => {
          const isSelected = h.id === selectedHeroine.id;

          return (
            <div
              key={h.id}
              onClick={() => setSelectedHeroine(h)}
              className={`group relative flex flex-col rounded-2xl border p-3.5 cursor-pointer transition-all duration-300 backdrop-blur-xl overflow-hidden ${
                isSelected
                  ? 'border-purple-400/80 bg-gradient-to-b from-purple-950/80 via-slate-950/90 to-black shadow-[0_0_30px_rgba(168,85,247,0.45),inset_0_0_15px_rgba(168,85,247,0.2)] scale-[1.02]'
                  : 'border-purple-900/40 bg-slate-950/85 hover:border-purple-500/60 hover:bg-purple-950/40 hover:shadow-[0_0_20px_rgba(168,85,247,0.25)]'
              }`}
            >
              {/* Top Role Badge */}
              <div className="w-full flex items-center justify-between text-[11px] mb-2.5 px-0.5">
                <span
                  className="font-bold uppercase tracking-wider text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-950/60"
                  style={{ color: h.themeColor }}
                >
                  {h.role}
                </span>
                <span className="text-base">{h.avatarIcon}</span>
              </div>

              {/* Framed Grok Portrait */}
              <div className="relative w-full aspect-square rounded-xl overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.9)] border border-purple-800/40 bg-black">
                <img
                  src={h.image}
                  alt={h.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-108"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-xs">
                  <span className="font-bold text-white drop-shadow font-serif tracking-wider">
                    {h.name}
                  </span>
                  <span className="text-[10px] font-mono font-bold" style={{ color: h.themeColor }}>
                    {h.stats.affinity}
                  </span>
                </div>
              </div>

              {/* Character Lore & Details */}
              <div className="mt-3 w-full space-y-1.5 text-left">
                <div className="text-xs font-bold text-purple-100 group-hover:text-white font-serif">
                  {h.title}
                </div>
                <div className="text-[11px] text-purple-300/80 line-clamp-2 italic leading-relaxed">
                  {h.quotes[0]}
                </div>
                <div className="pt-2 flex items-center justify-between text-[10px] text-purple-400 font-mono border-t border-purple-900/40">
                  <span>{h.stats.mana}</span>
                  <span className="text-purple-200">{h.stats.power}</span>
                </div>
              </div>

              {isSelected && (
                <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-purple-500 text-[10px] text-white font-bold shadow-[0_0_12px_rgba(168,85,247,0.9)]">
                  ✓
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Heroine Wisdom Banner */}
      <div className="rounded-2xl border border-purple-500/40 bg-gradient-to-r from-purple-950/60 via-slate-950/80 to-purple-950/60 p-4 flex items-center gap-4 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.8)]">
        <div className="relative shrink-0">
          <img
            src={selectedHeroine.image}
            alt={selectedHeroine.name}
            className="h-14 w-14 rounded-full object-cover border-2 shadow-[0_0_15px_rgba(168,85,247,0.6)]"
            style={{ borderColor: selectedHeroine.themeColor }}
          />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 border border-purple-400 text-xs">
            {selectedHeroine.avatarIcon}
          </span>
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider font-serif">
              {selectedHeroine.name} — {selectedHeroine.title}
            </span>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-950/80 font-mono"
              style={{ color: selectedHeroine.themeColor }}
            >
              {selectedHeroine.role}
            </span>
          </div>
          <p className="text-xs text-purple-100/90 italic mt-1 leading-relaxed">
            &ldquo;{selectedHeroine.quotes[0]}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}
