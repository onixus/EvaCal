/**
 * Проверки, требующие пересмотра из-за запроса на изменение (#103 §2.5).
 *
 * Пометка вычисляется, а не хранится: запрос на изменение в состоянии «на
 * оценке» или «принят», нацеленный на эту редакцию (или на её расчёт, если
 * комплект в запросе не указан), помечает проверки затронутых требований.
 * Редакция, которая сама является результатом принятого запроса, им не
 * помечается — её проверки уже заведены по новой формулировке.
 */
import { formatChangeRequestNumber } from '@/lib/changeRequests/workflow';

export const REVIEW_TRIGGER_STATUSES = ['submitted', 'accepted'] as const;

export interface ChangeRequestLike {
  id: string;
  seq: number;
  title: string;
  status: string;
  basePackageId: string | null;
  baseCalculationId: string;
  resultPackageId: string | null;
  affectedRequirements: unknown;
  proposedChanges: unknown;
}

export interface ReviewFlag {
  changeRequestId: string;
  /** «ЗИ-01». */
  label: string;
  title: string;
  status: 'submitted' | 'accepted';
}

/** Требования, которых касается запрос: выбранные и изменяемые/удаляемые. */
export function affectedRequirementIds(cr: ChangeRequestLike): string[] {
  const ids = new Set<string>();
  if (Array.isArray(cr.affectedRequirements)) {
    for (const r of cr.affectedRequirements) {
      const id = r && typeof r === 'object' ? (r as { id?: unknown }).id : null;
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  const items =
    cr.proposedChanges && typeof cr.proposedChanges === 'object'
      ? (cr.proposedChanges as { items?: unknown }).items
      : null;
  if (Array.isArray(items)) {
    for (const item of items) {
      const id =
        item && typeof item === 'object'
          ? (item as { requirementId?: unknown }).requirementId
          : null;
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return [...ids];
}

/** Запрос относится к этой редакции. */
export function targetsPackage(
  cr: ChangeRequestLike,
  pkg: { id: string; calculationId: string },
): boolean {
  if (cr.resultPackageId === pkg.id) return false;
  return cr.basePackageId
    ? cr.basePackageId === pkg.id
    : cr.baseCalculationId === pkg.calculationId;
}

/** Пометки «требует пересмотра» по requirementId. */
export function reviewFlagsByRequirement(
  pkg: { id: string; calculationId: string },
  changeRequests: ChangeRequestLike[],
): Map<string, ReviewFlag[]> {
  const map = new Map<string, ReviewFlag[]>();
  for (const cr of changeRequests) {
    if (!(REVIEW_TRIGGER_STATUSES as readonly string[]).includes(cr.status)) continue;
    if (!targetsPackage(cr, pkg)) continue;
    const flag: ReviewFlag = {
      changeRequestId: cr.id,
      label: formatChangeRequestNumber(cr.seq),
      title: cr.title,
      status: cr.status as ReviewFlag['status'],
    };
    for (const reqId of affectedRequirementIds(cr)) {
      map.set(reqId, [...(map.get(reqId) ?? []), flag]);
    }
  }
  return map;
}
