/**
 * Первоначальная договорная база и согласованные изменения (#103 §1.4).
 * Чисто: без БД, пригодно для клиента. Стоимость — десятичная строка, сумма
 * ведётся в копейках (BigInt), чтобы не терять точность.
 */

export interface BaselineFigures {
  calculationId: string;
  version: number;
  currency: string;
  hours: number;
  /** Цена без НДС по коммерческому профилю базовой версии. */
  priceExVat: number;
  /** Плановое окончание по Ганту базовой версии (ISO) или null. */
  plannedEnd: string | null;
}

export interface AcceptedChangeInput {
  id: string;
  seq: number;
  title: string;
  confirmedHours: number | null;
  confirmedCost: string | null;
  confirmedScheduleDays: number | null;
  decidedAt: string | null;
  baseCalculationId: string;
  resultCalculationId: string | null;
  resultPackageId: string | null;
}

export interface ChangeTraceRow {
  id: string;
  seq: number;
  title: string;
  hours: number;
  cost: string;
  scheduleDays: number;
  decidedAt: string | null;
  baseCalculationId: string;
  baseVersion: number | null;
  resultCalculationId: string | null;
  resultVersion: number | null;
  resultPackageId: string | null;
  resultPackageVersion: number | null;
}

export interface ChangeSummary {
  baseline: BaselineFigures | null;
  changes: ChangeTraceRow[];
  totals: { hours: number; cost: string; scheduleDays: number };
  /** База + изменения; null — базы нет (сделка не выиграна, изменений нет). */
  current: { hours: number; priceExVat: string } | null;
}

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

function toCents(value: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`Некорректная сумма: ${value}`);
  const cents = BigInt(m[2]) * HUNDRED + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] === '-' ? -cents : cents;
}

export function formatCents(cents: bigint): string {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const whole = abs / HUNDRED;
  const frac = String(abs % HUNDRED).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Сумма десятичных строк с точностью до копейки. */
export function sumDecimal(values: string[]): string {
  return formatCents(values.reduce((acc, v) => acc + toCents(v), ZERO));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Сводка: база + принятые изменения в порядке решения. Учитываются только
 * подтверждённые специалистом значения запроса — часы этапов не суммируются.
 */
export function summarizeChanges(
  baseline: BaselineFigures | null,
  accepted: AcceptedChangeInput[],
  versions: {
    calculations: Map<string, number>;
    packages: Map<string, number>;
  },
): ChangeSummary {
  const changes: ChangeTraceRow[] = [...accepted]
    .sort((a, b) => (a.decidedAt ?? '').localeCompare(b.decidedAt ?? '') || a.seq - b.seq)
    .map((cr) => ({
      id: cr.id,
      seq: cr.seq,
      title: cr.title,
      hours: cr.confirmedHours ?? 0,
      cost: cr.confirmedCost ?? '0.00',
      scheduleDays: cr.confirmedScheduleDays ?? 0,
      decidedAt: cr.decidedAt,
      baseCalculationId: cr.baseCalculationId,
      baseVersion: versions.calculations.get(cr.baseCalculationId) ?? null,
      resultCalculationId: cr.resultCalculationId,
      resultVersion: cr.resultCalculationId
        ? (versions.calculations.get(cr.resultCalculationId) ?? null)
        : null,
      resultPackageId: cr.resultPackageId,
      resultPackageVersion: cr.resultPackageId
        ? (versions.packages.get(cr.resultPackageId) ?? null)
        : null,
    }));

  const totals = {
    hours: round2(changes.reduce((s, c) => s + c.hours, 0)),
    cost: sumDecimal(changes.map((c) => c.cost)),
    scheduleDays: changes.reduce((s, c) => s + c.scheduleDays, 0),
  };

  const current = baseline
    ? {
        hours: round2(baseline.hours + totals.hours),
        priceExVat: formatCents(
          BigInt(Math.round(baseline.priceExVat * 100)) + toCents(totals.cost),
        ),
      }
    : null;

  return { baseline, changes, totals, current };
}
