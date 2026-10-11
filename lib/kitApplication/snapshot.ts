/**
 * Запись элементов набора в снимок черновика комплекта ГОСТ 34 (#103 WP-7b).
 * Чистые функции над копией снимка.
 *
 * - Требования добавляются legacy-строками мастера с `origin`.
 * - Проверки ведутся реестром `kitChecks`; их критерии и метод сводятся в
 *   `acceptanceCriteria` (и `criterion` строкой) и `verificationMethod`
 *   требования, откуда их берёт засев проверок приёмки (`extractCheckSeeds`).
 *   Правку пользователя пересчёт не затирает.
 * - Связи «требование → этап» — ручные связи трассируемости (`manualLinks`).
 * - Фрагменты — реестр `kitFragments` (id раздела схемы, текст, `origin`):
 *   при сборке документа они дописываются в раздел после всех правок
 *   (`lib/gost34/generation/kitAppendices.ts`), `sectionOverrides` не трогаются.
 */
import type { TraceLink } from '@/lib/gost34/traceability/types';
import type { GostWizardSnapshot } from '@/lib/project';
import { readOrigin } from './origin';
import { fragmentParagraphs } from '@/lib/gost34/generation/kitAppendices';
import {
  dedupeCriteria,
  type ApplicationPlan,
  type KitCheckEntry,
  type KitFragmentEntry,
} from './plan';

export function cloneSnapshot(snapshot: GostWizardSnapshot | null | undefined): GostWizardSnapshot {
  return snapshot ? (JSON.parse(JSON.stringify(snapshot)) as GostWizardSnapshot) : {};
}

export { fragmentParagraphs };

/**
 * Добавляет фрагмент в реестр `kitFragments`. В документ он попадает как
 * дополнение раздела (`applyKitAppendices`) после всех правок, ручные правки
 * разделов (`sectionOverrides`) не меняются.
 */
export function addFragment(snapshot: GostWizardSnapshot, entry: KitFragmentEntry): void {
  (snapshot.kitFragments ??= []).push(entry);
}

/** Убирает фрагмент набора из реестра (а значит, и его абзацы из документа). */
export function removeFragment(snapshot: GostWizardSnapshot, elementId: string, kitId: string) {
  const list = snapshot.kitFragments ?? [];
  const idx = list.findIndex((f) => f.origin.kitId === kitId && f.origin.elementId === elementId);
  if (idx >= 0) list.splice(idx, 1);
  if (list.length === 0) delete snapshot.kitFragments;
}

/**
 * Пересчёт критериев требований из набора: критерий самого требования плюс
 * критерии проверок реестра, ссылающихся на него (без повторов, в порядке
 * реестра). Список — `acceptanceCriteria` (засев приёмки получает по строке
 * на критерий), для строки мастера — `criterion` через «; »; метод — первый
 * заданный метод проверки.
 *
 * Правку пользователя пересчёт не затирает: последние значения из набора
 * хранятся в `kitAutoCriteria`, `kitAutoCriterion`, `kitAutoMethod`, и
 * значение пишется, только если текущее с ними совпадает (или его ещё не было).
 * Если пользователь исправил строку `criterion` в мастере, а список не трогал,
 * устаревший список снимается — засев берёт исправленную строку.
 * Требования без `origin` не трогаются.
 */
export function recomputeKitCriteria(snapshot: GostWizardSnapshot): void {
  const reqs = Array.isArray(snapshot.requirements) ? snapshot.requirements : [];
  const checks = snapshot.kitChecks ?? [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
    const joined = criteria.join('; ') || null;
    const method = related.find((c) => c.method)?.method ?? null;

    const stringEdited = 'kitAutoCriterion' in r && !same(r.criterion, r.kitAutoCriterion);
    const listEdited = 'kitAutoCriteria' in r && !same(r.acceptanceCriteria, r.kitAutoCriteria);
    if (!stringEdited && !listEdited) {
      if (criteria.length > 0) {
        r.acceptanceCriteria = criteria;
        r.criterion = joined;
      } else {
        delete r.acceptanceCriteria;
        delete r.criterion;
      }
      r.kitAutoCriteria = criteria.length > 0 ? criteria : null;
      r.kitAutoCriterion = joined;
    } else if (stringEdited && !listEdited) {
      delete r.acceptanceCriteria;
    }
    if (!('kitAutoMethod' in r) || same(r.verificationMethod, r.kitAutoMethod)) {
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
