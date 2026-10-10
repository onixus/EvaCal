import type {
  SpecificationCurrencyTotal,
  SpecificationItem,
  SpecificationSnapshot,
} from '../specification/types';
import {
  lineAmount,
  subtractDecimal,
  summarizeSpecification,
  toScaled,
} from '../specification/totals';
import { isDecimal } from '../specification/validation';
import { findMetric, metricDecimal } from './refs';
import type { SizingOutputValue } from './types';

export type SizingImpactStatus = 'ok' | 'deficit' | 'surplus' | 'unknown' | 'unlinked';

export interface SizingImpactRow {
  itemId: string;
  name: string;
  status: SizingImpactStatus;
  reason: string;
  metric: string | null;
  metricLabel: string;
  metricUnit: string;
  scenario: string;
  /** Потребность в связанном (текущем) прогоне редакции. */
  linkedRunId: string | null;
  linkedRequired: string | null;
  /** Потребность в новом прогоне; null — невозможно рассчитать. */
  newRequired: string | null;
  missingInputs: string[];
  unitCapacity: string;
  currentQuantity: string | null;
  /** quantity × unitCapacity. */
  coverage: string | null;
  /** coverage − newRequired: отрицательное — дефицит, положительное — избыток. */
  balance: string | null;
  proposedQuantity: string | null;
  /** Количество отличается от расчетного по связанному прогону: ручное решение. */
  manualQuantity: boolean;
  defaultSelected: boolean;
  currency: string;
  amountBefore: string | null;
  amountAfter: string | null;
  amountDelta: string | null;
}

export interface SizingImpactRun {
  id: string | null;
  source: 'profile' | 'manual';
  label: string;
  outputs: Record<string, SizingOutputValue[]>;
}

export interface SizingImpactPreview {
  version: number;
  run: {
    id: string | null;
    source: 'profile' | 'manual';
    label: string;
    ephemeral: boolean;
    outputs: Record<string, SizingOutputValue[]>;
  };
  rows: SizingImpactRow[];
  /** Метрики нового прогона (base), не покрытые ни одной позицией. */
  uncovered: Array<Pick<SizingOutputValue, 'key' | 'label' | 'unit' | 'value' | 'missing'>>;
  selections: SizingImpactSelection[];
  totals: { before: SpecificationCurrencyTotal[]; after: SpecificationCurrencyTotal[] };
  warnings: string[];
}

export interface SizingImpactSelection {
  itemId: string;
  /** Явное согласие заменить количество, введенное вручную. */
  allowManualOverride?: boolean;
}

/** Точное ceil(required / capacity) в целых единицах позиции (BigInt, без float). */
export function ceilQuantity(required: string, capacity: string): string {
  const a = toScaled(required);
  const b = toScaled(capacity);
  if (b <= BigInt(0)) throw new Error('Ёмкость единицы должна быть положительной');
  if (a <= BigInt(0)) return '0';
  return ((a + b - BigInt(1)) / b).toString();
}
function sameDecimal(a: string, b: string): boolean {
  return toScaled(a) === toScaled(b);
}
function multiply(a: string, b: string): string {
  return lineAmount({ quantity: a, unitPrice: b })!;
}
function sign(value: string): number {
  return value.startsWith('-') ? -1 : /^0(\.0+)?$/.test(value) ? 0 : 1;
}

export function evaluateItem(item: SpecificationItem, run: SizingImpactRun): SizingImpactRow {
  const ref = item.sizingRef;
  const row: SizingImpactRow = {
    itemId: item.id,
    name: item.name || item.id,
    status: 'unlinked',
    reason: 'Позиция не связана с сайзингом: соответствие потребности не проверяется.',
    metric: ref?.metric ?? null,
    metricLabel: ref?.metric ?? '',
    metricUnit: '',
    scenario: ref?.scenario ?? 'base',
    linkedRunId: ref?.runId ?? null,
    linkedRequired: ref?.requiredQuantity ?? null,
    newRequired: null,
    missingInputs: [],
    unitCapacity: ref?.unitCapacity ?? '1',
    currentQuantity: item.quantity,
    coverage: null,
    balance: null,
    proposedQuantity: null,
    manualQuantity: false,
    defaultSelected: false,
    currency: item.currency,
    amountBefore: lineAmount(item),
    amountAfter: lineAmount(item),
    amountDelta: null,
  };
  if (!ref) return row;
  row.manualQuantity =
    item.quantity !== null &&
    !sameDecimal(item.quantity, ceilQuantity(ref.requiredQuantity, row.unitCapacity));
  const metric = findMetric(run.outputs, ref.scenario, ref.metric);
  if (metric) {
    row.metricLabel = metric.label;
    row.metricUnit = metric.unit;
    row.missingInputs = metric.missing ?? [];
  }
  row.newRequired = metricDecimal(metric?.value);
  row.status = 'unknown';
  if (!metric) {
    row.reason = `В новом прогоне нет метрики «${ref.metric}» (сценарий ${row.scenario}): невозможно проверить соответствие.`;
    return row;
  }
  if (row.newRequired === null) {
    row.reason = `Метрика не рассчитана${row.missingInputs.length ? `: не заданы ${row.missingInputs.join(', ')}` : ''}. Невозможно проверить соответствие.`;
    return row;
  }
  if (item.quantity === null) {
    row.reason = 'Количество позиции не задано: невозможно проверить соответствие.';
    return row;
  }
  row.coverage = multiply(item.quantity, row.unitCapacity);
  row.balance = subtractDecimal(row.coverage, row.newRequired);
  const proposed = ceilQuantity(row.newRequired, row.unitCapacity);
  if (!isDecimal(proposed)) {
    row.reason = `Требуемое количество ${proposed} вне допустимого диапазона спецификации: невозможно проверить соответствие.`;
    return row;
  }
  const changed = !sameDecimal(proposed, item.quantity);
  if (changed) {
    row.proposedQuantity = proposed;
    row.amountAfter = lineAmount({ quantity: proposed, unitPrice: item.unitPrice });
  }
  const s = sign(row.balance);
  if (s < 0) {
    row.status = 'deficit';
    row.reason = `Дефицит: покрыто ${row.coverage} из ${row.newRequired} ${row.metricUnit}.`.trim();
  } else if (s > 0 && changed) {
    row.status = 'surplus';
    row.reason =
      `Избыток: покрыто ${row.coverage} при потребности ${row.newRequired} ${row.metricUnit}.`.trim();
  } else {
    row.status = 'ok';
    row.reason = 'Количество покрывает потребность нового прогона.';
  }
  if (row.manualQuantity)
    row.reason += ' Количество задано вручную: изменение только по явному решению.';
  if (row.amountBefore !== null && row.amountAfter !== null)
    row.amountDelta = subtractDecimal(row.amountAfter, row.amountBefore);
  // Связь обновляется и без изменения количества (новая потребность фиксируется в редакции).
  row.defaultSelected =
    !row.manualQuantity &&
    item.disposition === 'supply' &&
    (changed || row.linkedRequired !== row.newRequired || row.linkedRunId !== run.id);
  return row;
}

/** Новый снимок: выбранные строки получают новое количество и связь с новым прогоном. */
export function applySizingSelections(
  snapshot: SpecificationSnapshot,
  rows: SizingImpactRow[],
  selections: SizingImpactSelection[],
  run: SizingImpactRun,
): SpecificationSnapshot {
  const byId = new Map(rows.map((r) => [r.itemId, r]));
  const chosen = new Map(selections.map((s) => [s.itemId, s]));
  return {
    ...snapshot,
    status: 'draft',
    items: snapshot.items.map((item) => {
      const selection = chosen.get(item.id);
      const row = byId.get(item.id);
      if (!selection || !row || !item.sizingRef || row.newRequired === null) return item;
      if (row.status === 'unknown' || row.status === 'unlinked') return item;
      if (row.manualQuantity && !selection.allowManualOverride) return item;
      const quantity = row.proposedQuantity ?? item.quantity;
      const changed =
        quantity !== null && item.quantity !== null && !sameDecimal(quantity, item.quantity);
      return {
        ...item,
        quantity,
        // Изменение количества требует повторного подтверждения строки.
        confirmed: changed ? false : item.confirmed,
        // Эфемерный прогон (предпросмотр) не сохраняется: apply требует сохраненный прогон.
        sizingRef: {
          ...item.sizingRef,
          runId: run.id ?? 'preview',
          requiredQuantity: row.newRequired,
        },
        changeReason: changed
          ? `Сайзинг (${run.label}): ${row.metricLabel} ${row.linkedRequired ?? '?'} → ${row.newRequired}; количество ${item.quantity ?? '?'} → ${quantity}.`
          : row.status === 'deficit'
            ? `Сайзинг (${run.label}): потребность ${row.metricLabel} ${row.linkedRequired ?? '?'} → ${row.newRequired}; количество не изменено, дефицит сохраняется.`
            : `Сайзинг (${run.label}): потребность ${row.metricLabel} ${row.linkedRequired ?? '?'} → ${row.newRequired}, количество достаточно.`,
      };
    }),
  };
}

export function buildSizingImpact(
  snapshot: SpecificationSnapshot,
  run: SizingImpactRun,
  selections?: SizingImpactSelection[],
): SizingImpactPreview {
  const rows = snapshot.items.map((item) => evaluateItem(item, run));
  const linked = new Set(
    snapshot.items
      .filter((i) => i.sizingRef && (i.sizingRef.scenario ?? 'base') === 'base')
      .map((i) => i.sizingRef!.metric),
  );
  const uncovered = (run.outputs.base ?? [])
    .filter((o) => !linked.has(o.key))
    .map(({ key, label, unit, value, missing }) => ({ key, label, unit, value, missing }));
  const defaults = rows.filter((r) => r.defaultSelected).map((r) => ({ itemId: r.itemId }));
  const chosen = selections ?? defaults;
  const after = applySizingSelections(snapshot, rows, chosen, run);
  const warnings = [
    'Ручные количества и позиции без связи с сайзингом не изменяются автоматически.',
    'Цены не меняются: разница стоимости — количество × текущая цена позиции, без конвертации валют.',
  ];
  if (rows.some((r) => r.status === 'unknown'))
    warnings.push(
      'Для части позиций соответствие проверить невозможно: не хватает характеристик или входных данных. Это не успешный подбор.',
    );
  if (!rows.some((r) => r.status !== 'unlinked'))
    warnings.push(
      'Ни одна позиция спецификации не связана с метриками сайзинга: влияние на состав не определено.',
    );
  return {
    version: snapshot.version,
    run: {
      id: run.id,
      source: run.source,
      label: run.label,
      ephemeral: run.id === null,
      outputs: run.outputs,
    },
    rows,
    uncovered,
    selections: chosen,
    totals: { before: summarizeSpecification(snapshot), after: summarizeSpecification(after) },
    warnings,
  };
}
