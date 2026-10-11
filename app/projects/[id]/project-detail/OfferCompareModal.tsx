'use client';

import { useState, type ReactNode } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { formatCurrency } from '@/lib/commercial';
import {
  MAX_COMPARED_OFFERS,
  isOfferError,
  type OfferComparison,
  type OfferResult,
  type OfferVariant,
} from '@/lib/offerCompare';
import type { SerializedCalculation } from './types';

function signed(value: number, unit = ''): string {
  const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${text}${unit}`;
}

function money(v: OfferVariant, amount: number): string {
  return formatCurrency(amount, v.currency, {
    decimals: v.pricingMode === 'legacy_markup' ? 0 : 2,
  });
}

/**
 * Сравнение вариантов КП (#103 4.4): состав, себестоимость, цена, прибыль,
 * маржа, срок и подтверждённая спецификация по выбранным версиям. Первая
 * (самая ранняя) выбранная версия — база для разниц. Под каждым числом —
 * пояснение, как оно получено из сохранённых условий версии.
 */
export default function OfferCompareModal({
  projectId,
  calculations,
  onClose,
}: {
  projectId: string;
  calculations: SerializedCalculation[];
  onClose: () => void;
}) {
  const ordered = [...calculations].sort((a, b) => a.version - b.version);
  const [selected, setSelected] = useState<string[]>(ordered.slice(-2).map((c) => c.id));
  const [result, setResult] = useState<OfferComparison | null>(null);
  const [explain, setExplain] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setResult(null);
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_COMPARED_OFFERS
          ? prev
          : [...prev, id],
    );
  }

  async function compare() {
    // База — самая ранняя версия: так видно, что изменилось от первоначального КП.
    const ids = ordered.filter((c) => selected.includes(c.id)).map((c) => c.id);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/compare?ids=${ids.map(encodeURIComponent).join(',')}`,
        { cache: 'no-store' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Не удалось сравнить версии');
      setResult(data as OfferComparison);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  const variants = result?.variants ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-xs">
      <div
        className="card flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden shadow-2xl"
        role="dialog"
        aria-label="Сравнение вариантов КП"
        data-testid="offer-compare-modal"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Сравнение вариантов КП
            </h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              Цифры считаются по условиям, сохранённым в каждой версии (ставки, режим цены,
              проценты, даты этапов). Текущие ставки шаблона не применяются.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm font-bold text-slate-400 hover:text-slate-600 dark:hover:text-nord-4"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-slate-200 bg-white p-4 dark:border-nord-3 dark:bg-nord-0">
          <div className="flex flex-wrap gap-2">
            {ordered.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs dark:border-nord-3"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={`Версия v${c.version}`}
                />
                v{c.version} · {c.name}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary text-xs"
              disabled={loading || selected.length < 2}
              onClick={() => void compare()}
            >
              {loading ? 'Считаю…' : 'Сравнить'}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-nord-4">
              <input
                type="checkbox"
                checked={explain}
                onChange={(e) => setExplain(e.target.checked)}
              />
              Показывать, как получено каждое число
            </label>
            <span className="text-[11px] text-slate-400 dark:text-nord-muted">
              От 2 до {MAX_COMPARED_OFFERS} версий; база для разниц — самая ранняя выбранная.
            </span>
          </div>
          {error && (
            <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}
          {result && !result.sameCurrency && (
            <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-nord-yellow">
              Версии в разных валютах: денежные разницы не считаются, курс не подставляется.
            </div>
          )}
        </div>

        <div className="overflow-auto p-4">
          {variants.length > 0 && (
            <table className="w-full text-left text-xs" data-testid="offer-compare-table">
              <thead>
                <tr className="border-b border-slate-200 dark:border-nord-3">
                  <th className="w-40 py-2 pr-3 font-semibold text-slate-500 dark:text-nord-muted">
                    Показатель
                  </th>
                  {variants.map((v) => (
                    <th key={v.id} className="min-w-[14rem] py-2 pr-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-nord-6">
                          v{v.version}
                        </span>
                        <StatusBadge status={v.status} />
                        {v.id === result?.baselineId && (
                          <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-nord-3 dark:text-nord-4">
                            база
                          </span>
                        )}
                      </div>
                      <div className="font-normal text-slate-500 dark:text-nord-muted">
                        {v.name}
                        {v.versionComment ? ` — ${v.versionComment}` : ''}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top dark:divide-nord-3">
                <Row title="Условия" variants={variants}>
                  {(v) => (
                    <>
                      <div>{v.pricingModeLabel}</div>
                      <div className="text-slate-500 dark:text-nord-muted">
                        {v.pricingMode === 'target_margin' ? 'маржа' : 'наценка'}{' '}
                        {v.terms.marginPercent}% · накладные {v.terms.overheadPercent}% · скидка{' '}
                        {v.terms.discountPercent}% ·{' '}
                        {v.terms.includeVat ? `НДС ${v.terms.vatPercent}%` : 'без НДС'} ·{' '}
                        {v.currency}
                      </div>
                      <div className="text-slate-500 dark:text-nord-muted">
                        Ставки:{' '}
                        {v.rates
                          .map(
                            (r) =>
                              `${r.label} ${money(v, r.rate)}${r.source === 'default' ? ' (по умолчанию)' : ''}`,
                          )
                          .join('; ')}
                        {v.ratesCoverage !== 'stored' && (
                          <span className="text-amber-700 dark:text-nord-yellow">
                            {' '}
                            {v.ratesCoverage === 'default'
                              ? '— ставки не сохранены в версии'
                              : '— часть ставок не сохранена в версии'}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </Row>
                <Row title="Состав, чел·ч" variants={variants}>
                  {(v) => (
                    <>
                      <Value
                        main={`${v.composition.totalHours} ч`}
                        delta={v.delta?.totalHours}
                        unit=" ч"
                      />
                      <div className="text-slate-500 dark:text-nord-muted">
                        этапов {v.composition.stageCount}, рисков {v.composition.riskCount}
                      </div>
                      {v.delta && (
                        <StageDelta
                          added={v.delta.stagesAdded}
                          removed={v.delta.stagesRemoved}
                          changed={v.delta.stagesChanged}
                        />
                      )}
                      {explain && <Explain text={v.explain.hours} />}
                    </>
                  )}
                </Row>
                <Row title="Себестоимость" variants={variants}>
                  {(v) => (
                    <>
                      <Value
                        main={money(v, v.money.totalCost)}
                        delta={v.delta?.totalCost}
                        format={(d) => signed(d)}
                      />
                      {explain && <Explain text={v.explain.cost} />}
                    </>
                  )}
                </Row>
                <Row title="Поставка и статьи" variants={variants}>
                  {(v) => (
                    <div className="text-slate-600 dark:text-nord-4">
                      <div>
                        поставка {money(v, v.money.supplyPrice)} (себест.{' '}
                        {money(v, v.money.supplyCost)})
                      </div>
                      <div>статьи затрат {money(v, v.money.costItemsCost)}</div>
                      {v.money.incomplete && (
                        <div className="text-amber-700 dark:text-nord-yellow">
                          сумма неполная — неизвестное не считается нулём
                        </div>
                      )}
                    </div>
                  )}
                </Row>
                <Row title="Цена без НДС" variants={variants}>
                  {(v) => (
                    <>
                      <Value
                        main={money(v, v.money.subtotalExVat)}
                        delta={v.delta?.subtotalExVat}
                        format={(d) => signed(d)}
                      />
                      <div className="text-slate-500 dark:text-nord-muted">
                        к оплате {money(v, v.money.grandTotal)}
                      </div>
                      {explain && <Explain text={v.explain.price} />}
                    </>
                  )}
                </Row>
                <Row title="Прибыль" variants={variants}>
                  {(v) => (
                    <>
                      <Value
                        main={money(v, v.money.profit)}
                        delta={v.delta?.profit}
                        format={(d) => signed(d)}
                      />
                      {explain && <Explain text={v.explain.profit} />}
                    </>
                  )}
                </Row>
                <Row title="Маржа" variants={variants}>
                  {(v) => (
                    <>
                      <Value
                        main={v.money.marginPercent === null ? '—' : `${v.money.marginPercent}%`}
                        delta={v.delta?.marginPoints}
                        format={(d) => signed(d, ' п.п.')}
                      />
                      {explain && <Explain text={v.explain.margin} />}
                    </>
                  )}
                </Row>
                <Row title="Срок" variants={variants}>
                  {(v) => (
                    <>
                      <Value
                        main={v.term ? `${v.term.calendarDays} дн.` : '—'}
                        delta={v.delta?.termDays}
                        unit=" дн."
                      />
                      {explain && <Explain text={v.explain.term} />}
                    </>
                  )}
                </Row>
                <Row title="Спецификация" variants={variants}>
                  {(v) => (
                    <>
                      <div
                        className={
                          v.specification.incomplete || v.specification.state !== 'confirmed'
                            ? 'text-amber-700 dark:text-nord-yellow'
                            : 'text-slate-800 dark:text-nord-4'
                        }
                      >
                        {v.specification.lines.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                      {explain && <Explain text={v.explain.specification} />}
                    </>
                  )}
                </Row>
              </tbody>
            </table>
          )}
          {!result && !loading && (
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              Отметьте версии и нажмите «Сравнить».
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  title,
  variants,
  children,
}: {
  title: string;
  variants: OfferResult[];
  children: (v: OfferVariant) => ReactNode;
}) {
  return (
    <tr>
      <th className="py-2 pr-3 font-semibold text-slate-600 dark:text-nord-4">{title}</th>
      {variants.map((v) => (
        <td key={v.id} className="py-2 pr-3">
          {isOfferError(v) ? (
            <span className="text-rose-700 dark:text-rose-300">
              {title === 'Условия' ? v.error : '—'}
            </span>
          ) : (
            children(v)
          )}
        </td>
      ))}
    </tr>
  );
}

function Value({
  main,
  delta,
  unit = '',
  format,
}: {
  main: string;
  delta?: number | null;
  unit?: string;
  format?: (d: number) => string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-nord-6">{main}</span>
      {delta !== undefined && (
        <span className="tabular-nums text-slate-500 dark:text-nord-muted">
          {delta === null ? 'Δ —' : `Δ ${format ? format(delta) : signed(delta, unit)}`}
        </span>
      )}
    </div>
  );
}

function StageDelta({
  added,
  removed,
  changed,
}: {
  added: string[];
  removed: string[];
  changed: { name: string; from: number; to: number }[];
}) {
  if (!added.length && !removed.length && !changed.length) {
    return <div className="text-slate-400 dark:text-nord-muted">состав этапов как в базе</div>;
  }
  return (
    <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-nord-4">
      {added.map((n) => (
        <li key={`a-${n}`}>+ {n}</li>
      ))}
      {removed.map((n) => (
        <li key={`r-${n}`}>− {n}</li>
      ))}
      {changed.map((c) => (
        <li key={`c-${c.name}`}>
          ~ {c.name}: {c.from} → {c.to} ч
        </li>
      ))}
    </ul>
  );
}

function Explain({ text }: { text: string }) {
  return (
    <div className="mt-1 rounded bg-slate-50 p-1.5 text-[11px] leading-snug text-slate-500 dark:bg-nord-1/50 dark:text-nord-muted">
      {text}
    </div>
  );
}
