import Link from 'next/link';
import type { ChangeSummary } from '@/lib/changeRequests/totals';
import { formatChangeLabel, formatChangeRequestNumber } from '@/lib/changeRequests/workflow';

function signed(n: number | string): string {
  const v = Number(n);
  return v > 0 ? `+${n}` : String(n);
}

function money(value: string | number, currency: string): string {
  const n = Number(value);
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function signedMoney(value: string, currency: string): string {
  return `${Number(value) > 0 ? '+' : ''}${money(value, currency)}`;
}

/**
 * Первоначальная договорная база отдельно от согласованных изменений (#103
 * §1.4) с трассировкой «запрос → версия расчёта → версия комплекта».
 * `compact` — строка для шапки проекта.
 */
export default function ChangeSummaryPanel({
  summary,
  compact = false,
}: {
  summary: ChangeSummary;
  compact?: boolean;
}) {
  if (summary.changes.length === 0 && compact) return null;
  const currency = summary.baseline?.currency ?? 'RUB';

  if (compact) {
    return (
      <p className="text-xs text-slate-600 dark:text-nord-4">
        {summary.baseline ? (
          <>
            Первоначальная база v{summary.baseline.version}: {summary.baseline.hours} ч,{' '}
            {money(summary.baseline.priceExVat, currency)} без НДС ·{' '}
          </>
        ) : null}
        согласованные изменения ({summary.changes.length}): {signed(summary.totals.hours)} ч,{' '}
        {signedMoney(summary.totals.cost, currency)}, срок {signed(summary.totals.scheduleDays)}{' '}
        раб. дн.
      </p>
    );
  }

  return (
    <div className="card space-y-3 p-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
        Первоначальный объём и согласованные изменения
        <span
          className="ml-2 rounded-sm bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-nord-yellow"
          data-testid="labour-only-label"
        >
          без учёта поставки и прочих затрат
        </span>
      </h3>
      {summary.baseline ? (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">Первоначальная база</p>
            <p className="font-bold">
              v{summary.baseline.version}: {summary.baseline.hours} ч
            </p>
            <p className="text-xs">{money(summary.baseline.priceExVat, currency)} без НДС</p>
            {summary.baseline.plannedEnd && (
              <p className="text-xs text-slate-500">
                окончание по плану{' '}
                {new Date(summary.baseline.plannedEnd).toLocaleDateString('ru-RU')}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500">Согласованные изменения</p>
            <p className="font-bold">{signed(summary.totals.hours)} ч</p>
            <p className="text-xs">{signedMoney(summary.totals.cost, currency)} без НДС</p>
            <p className="text-xs text-slate-500">
              срок {signed(summary.totals.scheduleDays)} раб. дн.
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">С учётом изменений</p>
            <p className="font-bold">{summary.current?.hours} ч</p>
            <p className="text-xs">
              {summary.current ? money(summary.current.priceExVat, currency) : '—'} без НДС
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Первоначальная база не определена: зафиксируйте выигрыш сделки или примите первый запрос
          на изменение.
        </p>
      )}
      {summary.changes.length === 0 ? (
        <p className="text-xs text-slate-500">Принятых запросов на изменение нет.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-semibold">Изменение</th>
              <th className="py-1 font-semibold">Часы</th>
              <th className="py-1 font-semibold">Стоимость (подтверждено)</th>
              <th className="py-1 font-semibold">Цена версии по ставкам</th>
              <th className="py-1 font-semibold">Срок</th>
              <th className="py-1 font-semibold">Трассировка</th>
            </tr>
          </thead>
          <tbody>
            {summary.changes.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 dark:border-nord-3">
                <td className="py-1">
                  <span className="font-mono font-bold">{formatChangeLabel(c.seq)}</span> {c.title}
                </td>
                <td className="py-1">{signed(c.hours)}</td>
                <td className="py-1">{signedMoney(c.cost, currency)}</td>
                <td className="py-1">
                  {c.resultPriceExVat !== null ? money(c.resultPriceExVat, currency) : '—'}
                </td>
                <td className="py-1">{signed(c.scheduleDays)} дн.</td>
                <td className="py-1">
                  {formatChangeRequestNumber(c.seq)} · v{c.baseVersion ?? '?'} →{' '}
                  {c.resultCalculationId ? (
                    <Link
                      href={`/calculations/${c.resultCalculationId}`}
                      className="text-brand-700 hover:underline dark:text-nord-frost3"
                    >
                      расчёт v{c.resultVersion ?? '?'}
                    </Link>
                  ) : (
                    '—'
                  )}
                  {c.resultPackageVersion !== null && ` → комплект v${c.resultPackageVersion}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {summary.changes.length > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-nord-muted">
          Итоги считаются по подтверждённой специалистом стоимости изменения. В новой версии расчёта
          изменение — строка ИЗМ-NN в рисках, и её цена по ставкам ролей (колонка «Цена версии по
          ставкам», вся версия без НДС) может отличаться от согласованной суммы.
        </p>
      )}
      {summary.offChain > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          Принятых изменений вне цепочки от базы: {summary.offChain} — в итоги не входят.
        </p>
      )}
    </div>
  );
}
