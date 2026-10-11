'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/commercial';
import type { CommercialState } from '@/lib/commercialContourData';
import { COST_ITEM_KINDS, COST_ITEM_KIND_LABELS, type CostItemKind } from '@/lib/supply';
import {
  DISCOUNT_APPROVAL_STATUS_LABELS,
  DISCOUNT_DECIDE_ROLES,
  type DiscountApprovalStatus,
} from '@/lib/discountApproval';

type State = CommercialState & { viewer: { username: string; role: string } };

interface Draft {
  kind: CostItemKind;
  description: string;
  quantity: string;
  unitCost: string;
  currency: string;
  exchangeRate: string;
  exchangeRateDate: string;
  exchangeRateSource: string;
  specItemRef: string;
}

const emptyDraft = (currency: string): Draft => ({
  kind: 'subcontractor',
  description: '',
  quantity: '1',
  unitCost: '',
  currency,
  exchangeRate: '',
  exchangeRateDate: '',
  exchangeRateSource: '',
  specItemRef: '',
});

/**
 * Коммерческий контур КП (#103 §4.2–4.3, #101 §3): закреплённая спецификация,
 * дополнительные статьи затрат, итог с поставкой и пояснениями, порог маржи и
 * согласование скидки. Все суммы считает сервер по сохранённым данным.
 */
export default function CommercialContourPanel({ calculationId }: { calculationId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [requestComment, setRequestComment] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/calculations/${calculationId}/commercial`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'Не удалось загрузить КП');
      return;
    }
    setState(data as State);
  }, [calculationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Ошибка');
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return error ? (
      <div className="card p-4 text-sm text-rose-700 dark:text-rose-300">{error}</div>
    ) : null;
  }

  const s = state.summary;
  const supply = s.supply;
  const locked = state.status === 'approved';
  const money = (v: number) =>
    formatCurrency(v, s.currency, { decimals: s.pricingMode === 'legacy_markup' ? 0 : 2 });
  const canDecide = DISCOUNT_DECIDE_ROLES.includes(state.viewer.role);
  const supplyRefs = supply?.lines ?? [];

  async function saveDraft() {
    if (!draft) return;
    const ok = await call(`/api/calculations/${calculationId}/cost-items`, {
      method: 'POST',
      body: JSON.stringify({
        ...draft,
        unitCost: draft.unitCost.trim() === '' ? null : draft.unitCost.trim(),
        quantity: draft.quantity.trim(),
        exchangeRate: draft.exchangeRate.trim() || null,
        exchangeRateDate: draft.exchangeRateDate || null,
        exchangeRateSource: draft.exchangeRateSource.trim() || null,
        specItemRef: draft.specItemRef || null,
        order: supply?.costItems.length ?? 0,
      }),
    });
    if (ok) setDraft(null);
  }

  async function fillRate() {
    if (!draft) return;
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `/api/exchange-rates?from=${draft.currency}&to=${s.currency}&date=${draft.exchangeRateDate || today}`,
    );
    const data = await res.json().catch(() => ({}));
    const rate = data.rates?.[0];
    if (!res.ok || !rate) {
      setError(`В справочнике нет курса ${draft.currency}→${s.currency} на эту дату`);
      return;
    }
    setDraft({
      ...draft,
      exchangeRate: rate.rate,
      exchangeRateDate: rate.date,
      exchangeRateSource: rate.source,
    });
  }

  return (
    <div className="card space-y-4 p-5" data-testid="commercial-contour">
      <div>
        <h2 className="font-semibold text-slate-900 dark:text-nord-6">
          Итог КП: услуги, статьи затрат и поставка
        </h2>
        <p className="text-xs text-slate-500 dark:text-nord-muted">
          Считается сервером по сохранённым условиям расчёта. Панель выше показывает только труд;
          здесь — полный итог. Неизвестные цены, себестоимость и курсы не считаются нулём.
        </p>
      </div>
      {error && (
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
      {state.error && (
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {state.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="commercial-total">
        <Stat title="Себестоимость" value={money(s.total.cost)} />
        <Stat title="Цена без НДС" value={money(s.total.priceExVat)} />
        <Stat
          title="Прибыль / маржа"
          value={money(s.total.profit)}
          hint={
            s.total.marginPercent === null
              ? 'маржа не определена'
              : `${s.total.marginPercent.toFixed(2)}%`
          }
        />
        <Stat
          title="Итого к оплате"
          value={money(s.total.grandTotal)}
          hint={s.total.incomplete ? 'сумма неполная' : `НДС ${money(s.total.vat)}`}
          warn={s.total.incomplete}
        />
      </div>

      <section className="space-y-2 text-sm">
        <h3 className="font-medium">Поставка из спецификации</h3>
        <label className="flex flex-wrap items-center gap-2 text-xs">
          Подтверждённая редакция в КП:
          <select
            className="input text-xs"
            disabled={busy || locked}
            value={state.pinnedSpecificationVersion ?? ''}
            onChange={(e) =>
              void call(`/api/calculations/${calculationId}/commercial`, {
                method: 'PATCH',
                body: JSON.stringify({
                  pinnedSpecificationVersion: e.target.value ? Number(e.target.value) : null,
                }),
              })
            }
            aria-label="Редакция спецификации в КП"
          >
            <option value="">— без поставки —</option>
            {state.finalSpecificationVersions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
          {state.finalSpecificationVersions.length === 0 && (
            <span className="text-slate-500">нет подтверждённых редакций</span>
          )}
        </label>
        {supply && supply.lines.length > 0 && (
          <ul className="space-y-1 text-xs" data-testid="supply-lines">
            {supply.lines.map((l) => (
              <li
                key={l.ref}
                className={l.problems.length ? 'text-amber-700 dark:text-nord-yellow' : ''}
              >
                {l.explanation}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 text-sm">
        <h3 className="font-medium">Дополнительные статьи затрат</h3>
        {supply && supply.costItems.length > 0 ? (
          <ul className="space-y-1 text-xs" data-testid="cost-items">
            {supply.costItems.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-slate-100 px-1.5 dark:bg-nord-3">
                  {COST_ITEM_KIND_LABELS[c.kind as CostItemKind] ?? c.kind}
                </span>
                <span className={c.problems.length ? 'text-amber-700 dark:text-nord-yellow' : ''}>
                  {c.explanation}
                  {c.state === 'linked' &&
                    ' — себестоимость строки поставки, без отдельной наценки'}
                  {c.problems.length > 0 && ` (${c.problems.join('; ')})`}
                </span>
                {!locked && (
                  <button
                    className="btn-ghost text-xs"
                    disabled={busy}
                    onClick={() =>
                      void call(`/api/calculations/${calculationId}/cost-items/${c.id}`, {
                        method: 'DELETE',
                      })
                    }
                  >
                    Удалить
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">Статей нет.</p>
        )}
        {!locked && !draft && (
          <button
            className="btn-secondary text-xs"
            onClick={() => setDraft(emptyDraft(s.currency))}
          >
            + Статья затрат
          </button>
        )}
        {draft && (
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3 text-xs sm:grid-cols-3 dark:border-nord-3">
            <label>
              Вид
              <select
                className="input w-full text-xs"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as CostItemKind })}
              >
                {COST_ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {COST_ITEM_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              Описание
              <input
                className="input w-full text-xs"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label>
              Количество
              <input
                className="input w-full text-xs"
                value={draft.quantity}
                onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              />
            </label>
            <label>
              Стоимость за ед. (пусто — неизвестно)
              <input
                className="input w-full text-xs"
                value={draft.unitCost}
                onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })}
              />
            </label>
            <label>
              Валюта
              <input
                className="input w-full text-xs"
                value={draft.currency}
                maxLength={3}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
              />
            </label>
            {draft.currency !== s.currency && (
              <>
                <label>
                  Курс {draft.currency}→{s.currency}
                  <input
                    className="input w-full text-xs"
                    value={draft.exchangeRate}
                    onChange={(e) => setDraft({ ...draft, exchangeRate: e.target.value })}
                  />
                </label>
                <label>
                  Дата курса
                  <input
                    type="date"
                    className="input w-full text-xs"
                    value={draft.exchangeRateDate}
                    onChange={(e) => setDraft({ ...draft, exchangeRateDate: e.target.value })}
                  />
                </label>
                <label>
                  Источник курса
                  <input
                    className="input w-full text-xs"
                    value={draft.exchangeRateSource}
                    onChange={(e) => setDraft({ ...draft, exchangeRateSource: e.target.value })}
                  />
                </label>
                <button className="btn-ghost text-xs" type="button" onClick={() => void fillRate()}>
                  Взять курс из справочника
                </button>
              </>
            )}
            <label className="sm:col-span-2">
              Себестоимость строки спецификации (без отдельной наценки)
              <select
                className="input w-full text-xs"
                value={draft.specItemRef}
                onChange={(e) => setDraft({ ...draft, specItemRef: e.target.value })}
              >
                <option value="">— отдельная статья (наценяется вместе с услугами) —</option>
                {supplyRefs.map((l) => (
                  <option key={l.ref} value={l.ref}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 sm:col-span-3">
              <button
                className="btn-primary text-xs"
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                Сохранить
              </button>
              <button className="btn-ghost text-xs" onClick={() => setDraft(null)}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </section>

      {supply && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-600 dark:text-nord-4">
            Как посчитан итог
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-nord-4">
            <li>
              Услуги: себестоимость труда с накладными {money(s.totalCost - s.costItemsCost)} +
              статьи затрат {money(s.costItemsCost)} = {money(s.totalCost)}; цена услуг без НДС
              после скидки {s.discountPercent}% — {money(s.subtotalExVat)}.
            </li>
            {supply.explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              Итог: цена {money(s.subtotalExVat)} + {money(supply.supplyPrice)} ={' '}
              {money(s.total.priceExVat)}; себестоимость {money(s.totalCost)} +{' '}
              {money(supply.supplyCost)} = {money(s.total.cost)}; прибыль {money(s.total.profit)}.
            </li>
          </ul>
        </details>
      )}

      <section className="space-y-2 text-sm" data-testid="margin-gate">
        <h3 className="font-medium">Порог прибыльности</h3>
        <p
          className={`text-xs ${state.gate.requiresApproval && !state.gate.approved ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-nord-4'}`}
        >
          {state.gate.message}
        </p>
        {state.gate.requiresApproval && !state.gate.approved && !locked && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input text-xs"
              placeholder="Обоснование скидки"
              value={requestComment}
              onChange={(e) => setRequestComment(e.target.value)}
            />
            <button
              className="btn-secondary text-xs"
              disabled={busy}
              onClick={() =>
                void call(`/api/calculations/${calculationId}/discount-approvals`, {
                  method: 'POST',
                  body: JSON.stringify({ comment: requestComment }),
                }).then((ok) => ok && setRequestComment(''))
              }
            >
              Запросить согласование скидки {state.discountPercent}%
            </button>
          </div>
        )}
        {state.approvals.length > 0 && (
          <ul className="space-y-1 text-xs">
            {state.approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {new Date(a.createdAt).toLocaleDateString('ru-RU')} · {a.requestedBy}: скидка{' '}
                  {a.requestedPercent}%, маржа{' '}
                  {a.resultingMargin === null ? 'не определена' : `${a.resultingMargin}%`} при
                  пороге {a.minMarginPercent}% —{' '}
                  {DISCOUNT_APPROVAL_STATUS_LABELS[a.status as DiscountApprovalStatus] ?? a.status}
                  {a.decidedBy ? ` (${a.decidedBy})` : ''}
                  {a.comment ? ` · «${a.comment}»` : ''}
                  {a.decisionComment ? ` · решение: «${a.decisionComment}»` : ''}
                </span>
                {a.status === 'pending' && canDecide && a.requestedBy !== state.viewer.username && (
                  <>
                    <button
                      className="btn-primary text-xs"
                      disabled={busy}
                      onClick={() =>
                        void call(`/api/calculations/${calculationId}/discount-approvals/${a.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ decision: 'approved' }),
                        })
                      }
                    >
                      Согласовать
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={() =>
                        void call(`/api/calculations/${calculationId}/discount-approvals/${a.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ decision: 'rejected' }),
                        })
                      }
                    >
                      Отклонить
                    </button>
                  </>
                )}
                {a.status === 'pending' && a.requestedBy === state.viewer.username && (
                  <button
                    className="btn-ghost text-xs"
                    disabled={busy}
                    onClick={() =>
                      void call(`/api/calculations/${calculationId}/discount-approvals/${a.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ decision: 'withdrawn' }),
                      })
                    }
                  >
                    Отозвать
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  title,
  value,
  hint,
  warn,
}: {
  title: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-nord-3 dark:bg-nord-1/40">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
        {title}
      </div>
      <div
        className={`text-lg font-bold ${warn ? 'text-amber-700 dark:text-nord-yellow' : 'text-slate-900 dark:text-nord-6'}`}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-slate-500 dark:text-nord-muted">{hint}</div>}
    </div>
  );
}
