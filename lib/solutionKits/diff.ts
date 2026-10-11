/**
 * Сравнение двух версий набора проектного решения (#103 WP-7a).
 *
 * Элементы сопоставляются по `elementId` внутри раздела (как требования в
 * `lib/gost34/diff.ts` — по id): добавленные, удалённые, изменённые (со списком
 * изменённых полей и значениями до/после) и число неизменных. Перестановка
 * элементов без правки содержимого отмечается флагом `reordered`.
 * Элемент, перенесённый в другой раздел с тем же `elementId`, считается
 * удалённым из одного раздела и добавленным в другой.
 */
import { KIT_SECTIONS, type KitElement, type KitSection, type SolutionKitContent } from './content';

export interface KitElementChange {
  elementId: string;
  fields: string[];
  before: KitElement;
  after: KitElement;
}

export interface KitSectionDiff {
  added: KitElement[];
  removed: KitElement[];
  changed: KitElementChange[];
  unchangedCount: number;
  reordered: boolean;
}

export interface KitVersionDiff {
  from: { version: number } | null;
  to: { version: number };
  sections: Record<KitSection, KitSectionDiff>;
  summary: { added: number; removed: number; changed: number; unchanged: number };
  identical: boolean;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function changedFields(before: KitElement, after: KitElement): string[] {
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => k !== 'elementId',
  );
  return keys.filter((k) => stable(a[k]) !== stable(b[k])).sort();
}

function diffSection(before: KitElement[], after: KitElement[]): KitSectionDiff {
  const beforeById = new Map(before.map((e) => [e.elementId, e]));
  const afterById = new Map(after.map((e) => [e.elementId, e]));
  const added = after.filter((e) => !beforeById.has(e.elementId));
  const removed = before.filter((e) => !afterById.has(e.elementId));
  const changed: KitElementChange[] = [];
  let unchangedCount = 0;
  for (const e of after) {
    const prev = beforeById.get(e.elementId);
    if (!prev) continue;
    const fields = changedFields(prev, e);
    if (fields.length === 0) unchangedCount += 1;
    else changed.push({ elementId: e.elementId, fields, before: prev, after: e });
  }
  const commonBefore = before.map((e) => e.elementId).filter((id) => afterById.has(id));
  const commonAfter = after.map((e) => e.elementId).filter((id) => beforeById.has(id));
  const reordered = commonBefore.some((id, i) => commonAfter[i] !== id);
  return { added, removed, changed, unchangedCount, reordered };
}

/**
 * Разница версий `from` → `to`. `from = null` — первая версия: все элементы
 * считаются добавленными.
 */
export function diffKitVersions(
  from: { version: number; content: SolutionKitContent } | null,
  to: { version: number; content: SolutionKitContent },
): KitVersionDiff {
  const sections = Object.fromEntries(
    KIT_SECTIONS.map((s) => [
      s,
      diffSection((from?.content[s] ?? []) as KitElement[], to.content[s] as KitElement[]),
    ]),
  ) as Record<KitSection, KitSectionDiff>;
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const s of KIT_SECTIONS) {
    summary.added += sections[s].added.length;
    summary.removed += sections[s].removed.length;
    summary.changed += sections[s].changed.length;
    summary.unchanged += sections[s].unchangedCount;
  }
  const identical =
    summary.added === 0 &&
    summary.removed === 0 &&
    summary.changed === 0 &&
    KIT_SECTIONS.every((s) => !sections[s].reordered);
  return {
    from: from ? { version: from.version } : null,
    to: { version: to.version },
    sections,
    summary,
    identical,
  };
}
