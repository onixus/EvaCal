/**
 * Загрузка версий расчёта для сравнения вариантов КП (#103 4.4). Только
 * чтение сохранённых данных версий: ставки, режим цены, проценты, даты этапов
 * и подтверждённая редакция спецификации. Шаблон и текущие настройки не читаются.
 */
import { prisma } from '@/lib/prisma';
import {
  MAX_COMPARED_OFFERS,
  compareOffers,
  type OfferComparison,
  type OfferVersionInput,
} from '@/lib/offerCompare';
import { parseSpecification } from '@/lib/specification/validation';
import { FINAL_SPECIFICATION_STATUSES } from '@/lib/specification/types';
import { loadSupply } from '@/lib/commercialContourData';
import type { SupplyBreakdown } from '@/lib/supply';

export class OfferCompareError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Разбирает `ids` (через запятую): 2…MAX, без повторов. */
export function parseCompareIds(raw: string | null): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  if (unique.length < 2) {
    throw new OfferCompareError('Выберите хотя бы две версии для сравнения', 400);
  }
  if (unique.length > MAX_COMPARED_OFFERS) {
    throw new OfferCompareError(`Можно сравнить не больше ${MAX_COMPARED_OFFERS} версий`, 400);
  }
  return unique;
}

export async function loadOfferComparison(
  projectId: string,
  ids: string[],
): Promise<OfferComparison> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new OfferCompareError('Проект не найден', 404);

  const calcs = await prisma.calculation.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      projectId: true,
      version: true,
      name: true,
      status: true,
      versionComment: true,
      createdAt: true,
      startDate: true,
      pmHours: true,
      currency: true,
      roleRates: true,
      overheadPercent: true,
      pricingMode: true,
      marginPercent: true,
      discountPercent: true,
      vatPercent: true,
      includeVat: true,
      pinnedSpecificationVersion: true,
      stages: {
        orderBy: { order: 'asc' },
        select: {
          name: true,
          role: true,
          hours: true,
          isApprovalTask: true,
          startDate: true,
          endDate: true,
        },
      },
      risks: { orderBy: { order: 'asc' }, select: { description: true, hours: true } },
      specifications: {
        orderBy: { version: 'desc' },
        select: { version: true, status: true, data: true },
      },
    },
  });
  if (calcs.length !== ids.length) throw new OfferCompareError('Версия расчёта не найдена', 404);
  if (calcs.some((c) => c.projectId !== projectId)) {
    throw new OfferCompareError('Версия расчёта принадлежит другому проекту', 400);
  }

  const byId = new Map(calcs.map((c) => [c.id, c]));
  // #103 §4.2: поставка и статьи затрат каждой версии; ошибка одной версии
  // показывается в её колонке, остальные считаются.
  const supplies = new Map<
    string,
    { supply: SupplyBreakdown | null; supplyError: string | null }
  >();
  for (const c of calcs) {
    try {
      supplies.set(c.id, { supply: await loadSupply(c), supplyError: null });
    } catch (error) {
      supplies.set(c.id, {
        supply: null,
        supplyError: error instanceof Error ? error.message : 'Поставка не рассчитана',
      });
    }
  }
  const inputs: OfferVersionInput[] = ids.map((id) => {
    const c = byId.get(id)!;
    const latest = c.specifications[0] ?? null;
    const final = c.specifications.find((s) =>
      (FINAL_SPECIFICATION_STATUSES as readonly string[]).includes(s.status),
    );
    let specification: OfferVersionInput['specification'] = null;
    if (final) {
      try {
        const snapshot = parseSpecification(JSON.parse(final.data));
        specification = {
          version: final.version,
          status: final.status === 'released' ? 'released' : snapshot.status,
          items: snapshot.items,
          emptySupplyReason: snapshot.emptySupplyReason,
        };
      } catch {
        // Нечитаемая редакция не превращается в «0»: остаётся «не подтверждена».
        specification = null;
      }
    }
    return {
      id: c.id,
      version: c.version,
      name: c.name,
      status: c.status,
      versionComment: c.versionComment,
      createdAt: c.createdAt,
      startDate: c.startDate,
      pmHours: c.pmHours,
      terms: {
        currency: c.currency,
        roleRates: c.roleRates,
        overheadPercent: c.overheadPercent,
        pricingMode: c.pricingMode,
        marginPercent: c.marginPercent,
        discountPercent: c.discountPercent,
        vatPercent: c.vatPercent,
        includeVat: c.includeVat,
      },
      stages: c.stages,
      risks: c.risks,
      specification,
      latestSpecification: latest ? { version: latest.version, status: latest.status } : null,
      ...supplies.get(c.id),
    };
  });
  return compareOffers(inputs);
}
