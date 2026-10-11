/**
 * Запись элементов набора в снимок черновика комплекта ГОСТ 34 (#103 WP-7b).
 * Чистые функции над копией снимка.
 *
 * - Требования добавляются legacy-строками мастера с `origin`.
 * - Проверки ведутся реестром `kitChecks`; их критерии и метод сводятся в
 *   требования (`acceptanceCriteria`, `criterion`, `verificationMethod`),
 *   откуда их берёт засев проверок приёмки (`extractCheckSeeds`).
 * - Связи «требование → этап» — ручные связи трассируемости (`manualLinks`).
 * - Фрагменты — абзацы `sectionOverrides[sectionKey]` и реестр `kitFragments`.
 */
import type { TraceLink } from '@/lib/gost34/traceability/types';
import type { GostWizardSnapshot } from '@/lib/project';
import { readOrigin } from './origin';
import {
  dedupeCriteria,
  type ApplicationPlan,
  type KitCheckEntry,
  type KitFragmentEntry,
} from './plan';

type SectionOverride = { title?: string; paragraphs?: string[]; items?: string[] };

export function cloneSnapshot(snapshot: GostWizardSnapshot | null | undefined): GostWizardSnapshot {
  return snapshot ? (JSON.parse(JSON.stringify(snapshot)) as GostWizardSnapshot) : {};
}

export function fragmentParagraphs(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Добавляет абзацы фрагмента в раздел (раздела нет — создаёт). */
export function addFragment(snapshot: GostWizardSnapshot, entry: KitFragmentEntry): void {
  const overrides = (snapshot.sectionOverrides ??= {});
  const current: SectionOverride = overrides[entry.sectionKey] ?? {};
  overrides[entry.sectionKey] = {
    ...current,
    ...(current.title === undefined && entry.title ? { title: entry.title } : {}),
    paragraphs: [...(current.paragraphs ?? []), ...fragmentParagraphs(entry.text)],
  };
  (snapshot.kitFragments ??= []).push(entry);
}

/**
 * Убирает абзацы фрагмента из раздела (первое вхождение подряд идущего блока);
 * пустой раздел без пунктов удаляется. Правки пользователя в других абзацах
 * не трогаются.
 */
export function removeFragment(snapshot: GostWizardSnapshot, elementId: string, kitId: string) {
  const list = snapshot.kitFragments ?? [];
  const idx = list.findIndex((f) => f.origin.kitId === kitId && f.origin.elementId === elementId);
  if (idx < 0) return;
  const [entry] = list.splice(idx, 1);
  const section = snapshot.sectionOverrides?.[entry.sectionKey];
  if (!section?.paragraphs) return;
  const block = fragmentParagraphs(entry.text);
  const paragraphs = section.paragraphs;
  for (let i = 0; i + block.length <= paragraphs.length; i += 1) {
    if (block.every((p, j) => paragraphs[i + j] === p)) {
      paragraphs.splice(i, block.length);
      break;
    }
  }
  if (paragraphs.length === 0 && !(section.items?.length ?? 0)) {
    delete snapshot.sectionOverrides![entry.sectionKey];
  }
}

/**
 * Пересчёт критериев требований из набора: критерий самого требования плюс
 * критерии проверок реестра, ссылающихся на него (без повторов, в порядке
 * реестра); метод — первый заданный метод проверки. Требования без `origin`
 * не трогаются.
 */
export function recomputeKitCriteria(snapshot: GostWizardSnapshot): void {
  const reqs = Array.isArray(snapshot.requirements) ? snapshot.requirements : [];
  const checks = snapshot.kitChecks ?? [];
  for (const raw of reqs) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!readOrigin(r.origin)) continue;
    const id = String(r.id);
    const related = checks.filter((c) => c.requirementIds.includes(id));
    const criteria = dedupeCriteria([
      typeof r.kitCriterion === 'string' ? r.kitCriterion : null,
      ...related.map((c) => c.criteria),
    ]);
    if (criteria.length > 0) {
      r.acceptanceCriteria = criteria;
      r.criterion = criteria.join('; ');
    } else {
      delete r.acceptanceCriteria;
      delete r.criterion;
    }
    const method = related.find((c) => c.method)?.method;
    if (method) r.verificationMethod = method;
    else delete r.verificationMethod;
  }
}

export function addManualLink(snapshot: GostWizardSnapshot, sourceId: string, targetId: string) {
  const links = (snapshot.manualLinks ??= []) as TraceLink[];
  if (links.some((l) => l.sourceId === sourceId && l.targetId === targetId)) return;
  links.push({ sourceId, targetId, method: 'MANUAL', approved: true });
}

/**
 * Применяет план к копии снимка. `stageIdByElement` — Stage.id этапов набора
 * в расчёте (новых и прежних): по ним строятся ручные связи.
 */
export function applyPlanToSnapshot(
  base: GostWizardSnapshot | null | undefined,
  plan: ApplicationPlan,
  stageIdByElement: Map<string, string>,
  requirementIdByElement: Map<string, string>,
): { snapshot: GostWizardSnapshot; links: { requirementId: string; stageId: string }[] } {
  const snapshot = cloneSnapshot(base);
  const reqs = (snapshot.requirements ??= []);
  for (const item of plan.requirements) reqs.push(JSON.parse(JSON.stringify(item)));
  const checks: KitCheckEntry[] = (snapshot.kitChecks ??= []);
  for (const c of plan.checks) checks.push(JSON.parse(JSON.stringify(c)));
  for (const f of plan.fragments) addFragment(snapshot, JSON.parse(JSON.stringify(f)));
  recomputeKitCriteria(snapshot);

  const reqIds = new Map(requirementIdByElement);
  for (const item of plan.requirements) reqIds.set(item.origin.elementId, item.id);
  const links: { requirementId: string; stageId: string }[] = [];
  for (const l of plan.links) {
    const requirementId = reqIds.get(l.requirementElementId);
    const stageId = stageIdByElement.get(l.stageElementId);
    if (!requirementId || !stageId) continue;
    addManualLink(snapshot, requirementId, stageId);
    links.push({ requirementId, stageId });
  }
  if (snapshot.kitChecks.length === 0) delete snapshot.kitChecks;
  return { snapshot, links };
}
