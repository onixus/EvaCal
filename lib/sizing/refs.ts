import type { Prisma } from '../generated/prisma/client';
import type { SpecificationItem } from '../specification/types';
import { isDecimal, SpecificationError } from '../specification/validation';
import type { SizingOutputValue } from './types';

/** Число метрики → десятичная строка спецификации (≤ 6 знаков); null — не представимо. */
export function metricDecimal(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  const text = value.toFixed(6).replace(/\.?0+$/, '');
  return isDecimal(text) ? text : null;
}

export function findMetric(
  outputs: unknown,
  scenario: string | undefined,
  metric: string,
): SizingOutputValue | null {
  if (!outputs || typeof outputs !== 'object') return null;
  const list = (outputs as Record<string, unknown>)[scenario ?? 'base'];
  if (!Array.isArray(list)) return null;
  return (list as SizingOutputValue[]).find((o) => o?.key === metric) ?? null;
}

/**
 * Проверяет, что каждая связь строки с сайзингом ссылается на прогон этого
 * расчета, а зафиксированная потребность совпадает с сохраненным результатом.
 * Возвращает уникальные идентификаторы прогонов для снимка редакции.
 */
export async function verifySizingRefs(
  db: Pick<Prisma.TransactionClient, 'sizingRun'>,
  calculationId: string,
  items: SpecificationItem[],
): Promise<string[]> {
  const ids = [...new Set(items.flatMap((i) => (i.sizingRef ? [i.sizingRef.runId] : [])))];
  if (!ids.length) return [];
  const runs = await db.sizingRun.findMany({
    where: { id: { in: ids }, calculationId },
    select: { id: true, outputs: true },
  });
  const byId = new Map(runs.map((r) => [r.id, r.outputs]));
  for (const item of items) {
    const ref = item.sizingRef;
    if (!ref) continue;
    const outputs = byId.get(ref.runId);
    if (outputs === undefined)
      throw new SpecificationError(
        `${item.name || item.id}: прогон сайзинга не найден в этом расчете`,
        409,
      );
    const value = metricDecimal(findMetric(outputs, ref.scenario, ref.metric)?.value);
    if (value === null || Number(value) !== Number(ref.requiredQuantity))
      throw new SpecificationError(
        `${item.name || item.id}: потребность не совпадает с сохраненным прогоном сайзинга`,
        409,
      );
  }
  return ids.sort();
}
