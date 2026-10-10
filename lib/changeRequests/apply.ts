import { createHash } from 'node:crypto';
import type { ProposedChanges } from './types';

/**
 * Чистые преобразования принятия запроса на изменение (#103 WP-2b): отпечаток
 * базы, сопоставление этапов базы и новой версии, правка требований снимка
 * комплекта. Запись в БД — lib/changeRequests/decisions.ts.
 */

type RawRecord = Record<string, unknown>;

export interface FingerprintInput {
  calculation: {
    pmHours: number;
    currency: string;
    pricingMode: string;
    roleRates: string | null;
    overheadPercent: number;
    marginPercent: number;
    discountPercent: number;
    vatPercent: number;
    includeVat: boolean;
    stages: Array<{
      id: string;
      name: string;
      role: string;
      hours: number;
      order: number;
      isApprovalTask: boolean;
      requirements: string | null;
    }>;
    risks: Array<{ description: string; hours: number; order: number }>;
  };
  basePackage: { snapshot: string | null; documentTypes: string } | null;
}

/**
 * Отпечаток содержимого базы: этапы, риски, РП, коммерческий профиль и снимок
 * комплекта. Метки времени и статусы не входят — смена статуса расчёта не
 * делает оценку устаревшей, а правка часов или требований делает.
 */
export function computeBaseFingerprint(input: FingerprintInput): string {
  const c = input.calculation;
  const canonical = JSON.stringify([
    [
      c.pmHours,
      c.currency,
      c.pricingMode,
      c.roleRates,
      c.overheadPercent,
      c.marginPercent,
      c.discountPercent,
      c.vatPercent,
      c.includeVat,
    ],
    [...c.stages]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((s) => [s.id, s.name, s.role, s.hours, s.order, s.isApprovalTask, s.requirements]),
    [...c.risks]
      .sort((a, b) => a.order - b.order || a.description.localeCompare(b.description))
      .map((r) => [r.description, r.hours, r.order]),
    input.basePackage ? [input.basePackage.documentTypes, input.basePackage.snapshot] : null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

interface StageKeyed {
  id: string;
  name: string;
  role: string;
  order: number;
  isApprovalTask: boolean;
}

/**
 * Этапы базы → этапы новой версии. Версия клонирует этапы, поэтому они
 * совпадают по (порядок, название, роль, согласование); повторы различаются
 * номером вхождения. Не найденный этап просто не попадает в карту — связи на
 * него в новом снимке не переносятся, а движок трассировки их проигнорирует.
 */
export function matchStageIds(base: StageKeyed[], next: StageKeyed[]): Map<string, string> {
  const key = (s: StageKeyed) => `${s.order}|${s.name}|${s.role}|${s.isApprovalTask}`;
  const pool = new Map<string, string[]>();
  for (const s of [...next].sort((a, b) => a.order - b.order)) {
    const list = pool.get(key(s)) ?? [];
    list.push(s.id);
    pool.set(key(s), list);
  }
  const map = new Map<string, string>();
  for (const s of [...base].sort((a, b) => a.order - b.order)) {
    const id = pool.get(key(s))?.shift();
    if (id) map.set(s.id, id);
  }
  return map;
}

export interface AppliedSnapshot {
  snapshot: RawRecord;
  modified: number;
  removed: number;
  added: number;
}

function isV2(r: RawRecord): boolean {
  return !!r.approval && typeof r.approval === 'object';
}

/**
 * Новый снимок комплекта: изменения запроса применены к требованиям базы,
 * связи перенесены на этапы новой версии. Изменённое и новое требование
 * получают новую исходную редакцию и статус черновика — их заново проверяют в
 * ревью комплекта; метка `changeRef` указывает на изменение.
 */
export function applyProposedChanges(
  baseSnapshot: unknown,
  proposed: ProposedChanges,
  label: string,
  stageIdMap: Map<string, string>,
  now: Date = new Date(),
): AppliedSnapshot {
  const snapshot: RawRecord =
    baseSnapshot && typeof baseSnapshot === 'object'
      ? (JSON.parse(JSON.stringify(baseSnapshot)) as RawRecord)
      : {};
  const remap = (id: unknown) =>
    typeof id === 'string' && id ? (stageIdMap.get(id) ?? null) : null;

  const removedIds = new Set(
    proposed.items.filter((i) => i.kind === 'remove').map((i) => i.requirementId as string),
  );
  const modifications = new Map(
    proposed.items
      .filter((i) => i.kind === 'modify')
      .map((i) => [i.requirementId as string, i.text]),
  );

  let modified = 0;
  const requirements = (Array.isArray(snapshot.requirements) ? snapshot.requirements : [])
    .filter((r): r is RawRecord => !!r && typeof r === 'object')
    .filter((r) => !removedIds.has(String(r.id)))
    .map((r) => {
      const next: RawRecord = { ...r };
      if ('mappedStageId' in next) {
        const mapped = remap(next.mappedStageId);
        if (mapped) next.mappedStageId = mapped;
        else delete next.mappedStageId;
      }
      const text = modifications.get(String(r.id));
      if (text === undefined) return next;
      modified++;
      next.originalText = text;
      next.changeRef = label;
      if (isV2(r)) {
        delete next.normalizedText;
        next.approval = { status: 'DRAFT' };
      } else {
        next.description = text;
        delete next.normalizedBy;
      }
      return next;
    });

  const additions = proposed.items.filter((i) => i.kind === 'add');
  additions.forEach((item, idx) => {
    const n = idx + 1;
    requirements.push({
      id: `${label}-${n}`,
      code: `${label}.${n}`,
      category: 'functional',
      title: item.text.length > 120 ? `${item.text.slice(0, 117)}…` : item.text,
      description: item.text,
      originalText: item.text,
      changeRef: label,
    });
  });

  const links = Array.isArray(snapshot.manualLinks) ? snapshot.manualLinks : [];
  snapshot.manualLinks = links
    .filter((l): l is RawRecord => !!l && typeof l === 'object')
    .filter((l) => !removedIds.has(String(l.sourceId)))
    .flatMap((l) => {
      const target =
        typeof l.targetId === 'string' ? l.targetId : (l.targetStageId as string | undefined);
      // Решение «не распределено» (пустая цель) переносится как есть.
      if (!target) return [l];
      const mapped = remap(target);
      if (!mapped) return [];
      const next: RawRecord = { ...l };
      if ('targetStageId' in next) next.targetStageId = mapped;
      if ('targetId' in next || !('targetStageId' in next)) next.targetId = mapped;
      return [next];
    });

  snapshot.requirements = requirements;
  snapshot.updatedAt = now.toISOString();
  return { snapshot, modified, removed: removedIds.size, added: additions.length };
}
