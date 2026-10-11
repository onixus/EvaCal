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
    startDate: Date | string;
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
      parallel: boolean;
      approvalDays: number | null;
    }>;
    risks: Array<{ description: string; hours: number; order: number }>;
    dependencies: Array<{ fromStageId: string; toStageId: string; type: string; lagDays: number }>;
  };
  basePackage: { snapshot: string | null; documentTypes: string } | null;
}

/**
 * Поля снимка комплекта, которые не определяют содержание документа: правка
 * подписей, шаг мастера или метка сохранения не делают оценку устаревшей.
 */
const SNAPSHOT_NON_CONTENT_KEYS = new Set(['updatedAt', 'activeStep', 'tzAuthor', 'signatures']);

/** JSON с отсортированными ключами — одинаковое содержание даёт одинаковую строку. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as RawRecord)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Содержательная часть снимка комплекта (без подписей, шага мастера и меток времени). */
export function snapshotContent(snapshot: string | null): string {
  let parsed: unknown = null;
  try {
    parsed = snapshot ? JSON.parse(snapshot) : null;
  } catch {
    // Нечитаемый снимок хэшируется как есть — любая его правка всё равно заметна.
    return `raw:${snapshot}`;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return canonicalJson(parsed);
  const content = Object.fromEntries(
    Object.entries(parsed as RawRecord).filter(([k]) => !SNAPSHOT_NON_CONTENT_KEYS.has(k)),
  );
  return canonicalJson(content);
}

/**
 * Отпечаток содержимого базы: этапы (с параметрами Ганта), явные зависимости,
 * старт, риски, РП, коммерческий профиль и содержательная часть снимка
 * комплекта. Метки времени, статусы и подписи не входят — смена статуса
 * расчёта не делает оценку устаревшей, а правка часов, плана или требований
 * делает.
 */
export function computeBaseFingerprint(input: FingerprintInput): string {
  const c = input.calculation;
  const canonical = JSON.stringify([
    [
      new Date(c.startDate).toISOString(),
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
      .map((s) => [
        s.id,
        s.name,
        s.role,
        s.hours,
        s.order,
        s.isApprovalTask,
        s.requirements,
        s.parallel,
        s.approvalDays,
      ]),
    [...c.risks]
      .sort((a, b) => a.order - b.order || a.description.localeCompare(b.description))
      .map((r) => [r.description, r.hours, r.order]),
    [...c.dependencies]
      .map((d) => [d.fromStageId, d.toStageId, d.type, d.lagDays])
      .sort((a, b) => String(a).localeCompare(String(b))),
    input.basePackage
      ? [input.basePackage.documentTypes, snapshotContent(input.basePackage.snapshot)]
      : null,
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

function shortTitle(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
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
        next.title = shortTitle(text);
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
      title: shortTitle(item.text),
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
  // Подписи, автор ТЗ и шаг мастера принадлежат выпуску базы: черновик новой
  // версии подписывают и проходят заново.
  delete snapshot.signatures;
  delete snapshot.tzAuthor;
  delete snapshot.activeStep;
  snapshot.updatedAt = now.toISOString();
  return { snapshot, modified, removed: removedIds.size, added: additions.length };
}
