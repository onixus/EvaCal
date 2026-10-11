/**
 * Запись элементов набора в снимок черновика комплекта ГОСТ 34 (#103 WP-7b).
 * Чистые функции над копией снимка.
 *
 * - Требования добавляются legacy-строками мастера с `origin`.
 * - Проверки ведутся реестром `kitChecks`; их критерии и метод сводятся в
 *   `criterion` и `verificationMethod` требования, откуда их берёт засев
 *   проверок приёмки (`extractCheckSeeds`). Правку критерия пользователем
 *   пересчёт не затирает (сравнение с последним значением из набора).
 * - Связи «требование → этап» — ручные связи трассируемости (`manualLinks`).
 * - Фрагменты — дополнительные абзацы раздела (`sectionOverrides[key]
 *   .appendParagraphs`): сгенерированный текст раздела и ручная замена
 *   абзацев сохраняются (`lib/gost34/generation/overrides.ts`); реестр
 *   `kitFragments` хранит происхождение.
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

type SectionOverride = {
  title?: string;
  paragraphs?: string[];
  items?: string[];
  appendParagraphs?: string[];
};

export function cloneSnapshot(snapshot: GostWizardSnapshot | null | undefined): GostWizardSnapshot {
  return snapshot ? (JSON.parse(JSON.stringify(snapshot)) as GostWizardSnapshot) : {};
}

export function fragmentParagraphs(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Добавляет абзацы фрагмента в конец раздела, не заменяя ни сгенерированный
 * текст, ни ручную замену абзацев: `appendParagraphs`. Заголовок раздела не
 * меняется.
 */
export function addFragment(snapshot: GostWizardSnapshot, entry: KitFragmentEntry): void {
  const overrides = (snapshot.sectionOverrides ??= {});
  const current: SectionOverride = overrides[entry.sectionKey] ?? {};
  overrides[entry.sectionKey] = {
    ...current,
    appendParagraphs: [...(current.appendParagraphs ?? []), ...fragmentParagraphs(entry.text)],
  };
  (snapshot.kitFragments ??= []).push(entry);
}

/**
 * Убирает абзацы фрагмента из дополнительных абзацев раздела (первое
 * вхождение подряд идущего блока). Пустая запись раздела удаляется; ручные
 * абзацы и пункты не трогаются.
 */
export function removeFragment(snapshot: GostWizardSnapshot, elementId: string, kitId: string) {
  const list = snapshot.kitFragments ?? [];
  const idx = list.findIndex((f) => f.origin.kitId === kitId && f.origin.elementId === elementId);
  if (idx < 0) return;
  const [entry] = list.splice(idx, 1);
  const section = snapshot.sectionOverrides?.[entry.sectionKey] as SectionOverride | undefined;
  if (!section?.appendParagraphs) return;
  const block = fragmentParagraphs(entry.text);
  const paragraphs = section.appendParagraphs;
  for (let i = 0; i + block.length <= paragraphs.length; i += 1) {
    if (block.every((p, j) => paragraphs[i + j] === p)) {
      paragraphs.splice(i, block.length);
      break;
    }
  }
  if (paragraphs.length === 0) delete section.appendParagraphs;
  if (Object.keys(section).length === 0) delete snapshot.sectionOverrides![entry.sectionKey];
}

/**
 * Пересчёт критериев требований из набора: критерий самого требования плюс
 * критерии проверок реестра, ссылающихся на него (без повторов, в порядке
 * реестра), одной строкой `criterion`; метод — первый заданный метод
 * проверки. Значение пишется, только если пользователь его не правил:
 * текущее совпадает с последним значением из набора (`kitAutoCriterion`,
 * `kitAutoMethod`) или его ещё не было. Требования без `origin` не трогаются.
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
    const criterion =
      dedupeCriteria([
        typeof r.kitCriterion === 'string' ? r.kitCriterion : null,
        ...related.map((c) => c.criteria),
      ]).join('; ') || null;
    const method = related.find((c) => c.method)?.method ?? null;

    const untouched = (field: string, auto: string) =>
      !(auto in r) || (r[field] ?? null) === (r[auto] ?? null);
    if (untouched('criterion', 'kitAutoCriterion')) {
      if (criterion) r.criterion = criterion;
      else delete r.criterion;
      r.kitAutoCriterion = criterion;
    }
    if (untouched('verificationMethod', 'kitAutoMethod')) {
      if (method) r.verificationMethod = method;
      else delete r.verificationMethod;
      r.kitAutoMethod = method;
    }
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
