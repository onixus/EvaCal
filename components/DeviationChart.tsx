'use client';

import { useState } from 'react';

export interface DeviationBar {
  key: string;
  label: string;
  /** Доля: +0.2 = перерасход 20%. null — нет данных. */
  value: number | null;
  samples: number;
  lowSample?: boolean;
  /** Подпись на ховере. */
  detail?: string;
}

/**
 * Диверджентные горизонтальные полосы вокруг нуля: перерасход вправо
 * (розовый), недорасход влево (синий). Одна ось, нейтральный ноль. Цвета
 * прошли валидацию на светлом и тёмном фоне; идентичность несёт подпись
 * строки, а не цвет.
 */
export default function DeviationChart({
  bars,
  tolerance = 0.1,
  maxBars = 20,
}: {
  bars: DeviationBar[];
  tolerance?: number;
  maxBars?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = bars.filter((b) => b.value !== null).slice(0, maxBars);
  if (shown.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-slate-500 dark:text-nord-muted">
        Нет задач с внесённым фактом.
      </p>
    );
  }
  const maxAbs = Math.max(0.25, ...shown.map((b) => Math.abs(b.value as number)));
  const labelW = 190;
  const plotW = 420;
  const rowH = 22;
  const h = shown.length * rowH + 28;
  const zeroX = labelW + plotW / 2;
  const scale = plotW / 2 / maxAbs;
  const tolPx = tolerance * scale;
  const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];

  return (
    <div className="overflow-x-auto" role="img" aria-label="Медианные отклонения по задачам">
      <svg width={labelW + plotW + 40} height={h} className="text-slate-700 dark:text-nord-4">
        {/* допуск */}
        <rect
          x={zeroX - tolPx}
          y={0}
          width={tolPx * 2}
          height={h - 20}
          className="fill-slate-100 dark:fill-nord-1"
        />
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={zeroX + t * scale}
              x2={zeroX + t * scale}
              y1={0}
              y2={h - 20}
              className={
                t === 0
                  ? 'stroke-slate-400 dark:stroke-nord-4'
                  : 'stroke-slate-200 dark:stroke-nord-3'
              }
              strokeWidth={t === 0 ? 1.5 : 1}
            />
            <text
              x={zeroX + t * scale}
              y={h - 6}
              textAnchor="middle"
              fontSize={10}
              className="fill-slate-500 dark:fill-nord-muted"
            >
              {`${t > 0 ? '+' : ''}${Math.round(t * 100)}%`}
            </text>
          </g>
        ))}
        {shown.map((b, i) => {
          const v = b.value as number;
          const y = i * rowH + 4;
          const w = Math.max(2, Math.abs(v) * scale);
          const x = v >= 0 ? zeroX + 1 : zeroX - 1 - w;
          const over = v > tolerance;
          const under = v < -tolerance;
          // Заливка через классы: тёмная тема берёт свой оттенок, прошедший валидацию.
          const fillCls = over
            ? 'fill-[#e11d48] dark:fill-[#f43f5e]'
            : under
              ? 'fill-[#0284c7]'
              : 'fill-slate-400 dark:fill-nord-muted';
          const active = hover === b.key;
          return (
            <g
              key={b.key}
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default"
            >
              <rect x={0} y={y - 2} width={labelW + plotW} height={rowH} fill="transparent" />
              <text
                x={labelW - 8}
                y={y + 10}
                textAnchor="end"
                fontSize={11}
                className="fill-current"
              >
                {b.label.length > 30 ? `${b.label.slice(0, 29)}…` : b.label}
                {b.lowSample ? ' *' : ''}
              </text>
              <rect
                x={x}
                y={y}
                width={w}
                height={rowH - 8}
                rx={4}
                className={fillCls}
                opacity={active ? 1 : 0.85}
              />
              <text
                x={v >= 0 ? x + w + 4 : x - 4}
                y={y + 10}
                textAnchor={v >= 0 ? 'start' : 'end'}
                fontSize={10}
                className="fill-slate-600 dark:fill-nord-4"
              >
                {`${v > 0 ? '+' : ''}${Math.round(v * 100)}% · n=${b.samples}`}
              </text>
              {active && b.detail && <title>{b.detail}</title>}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-[10px] text-slate-500 dark:text-nord-muted">
        <span>
          <i
            className="inline-block h-2.5 w-2.5 rounded align-middle"
            style={{ background: '#e11d48' }}
          />{' '}
          перерасход
        </span>
        <span>
          <i
            className="inline-block h-2.5 w-2.5 rounded align-middle"
            style={{ background: '#0284c7' }}
          />{' '}
          недорасход
        </span>
        <span>
          <i className="inline-block h-2.5 w-2.5 rounded bg-slate-300 align-middle" /> в допуске ±
          {Math.round(tolerance * 100)}%
        </span>
        <span>* мало данных</span>
      </div>
    </div>
  );
}
