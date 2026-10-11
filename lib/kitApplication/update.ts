/**
 * Использование наборов в проекте и предложения обновлений (#103 WP-7b, 7.4).
 * Чистые функции.
 *
 * Содержимое проекта по набору собирается из провенанса элементов: этапы и
 * риски расчёта (`originRef`), требования снимка (`origin`), реестры проверок
 * и фрагментов. У каждого элемента своя версия набора, из которой он пришёл.
 *
 * Предложение сравнивает по `elementId` адаптированное содержимое проекта с
 * последней утверждённой версией набора:
 * - `changed` — элемент есть в обоих, значения различаются (`kitChanged` —
 *   изменился ли элемент в самом наборе с версии, из которой он пришёл, или
 *   разница — правка проекта при адаптации);
 * - `added` — элемента нет в проекте и не было в версии, на которой проект
 *   основан (новый в наборе; исключённые при адаптации не предлагаются снова);
 * - `removed` — элемента проекта нет в новой версии набора.
 * Применяются только выбранные изменения — в новую черновую версию расчёта;
 * согласованные версии не меняются никогда.
 */
import type { GostWizardSnapshot } from '@/lib/project';
import type { PrimaryStageInput } from '@/lib/scheduling';
import type { KitSection, SolutionKitContent } from '@/lib/solutionKits/content';
import { formatOriginRef, kitRequirementId, parseOriginRef, readOrigin } from './origin';
import {
  buildApplicationPlan,
  kitStageHours,
  type ApplicationPlan,
  type ExistingKitState,
  type KitCheckEntry,
} from './plan';
import { addFragment, addManualLink, recomputeKitCriteria, removeFragment } from './snapshot';
import { REQUIREMENT_CATEGORY_LABELS } from '@/lib/gost34/types';
import { resolveTzSectionId } from './sections';

export type UpdateSection = Exclude<KitSection, 'fields'>;
type Values = Record<string, unknown>;

export interface ProjectStageRow {
  id: string;
  name: string;
  role: string;
  hours: number;
  requirements: string | null;
  isApprovalTask: boolean;
  parallel?: boolean;
  approvalDays?: number | null;
  originRef: string | null;
}

export interface ProjectRiskRow {
  id: string;
  description: string;
  hours: number;
  order: number;
  originRef: string | null;
}

export interface ProjectKitElement {
  section: UpdateSection;
  elementId: string;
  kitVersion: number;
  /** Stage.id, Risk.id, id требования снимка; для проверок и фрагментов — elementId. */
  rowId: string;
  values: Values;
}

export interface ProjectKitUsage {
  kitId: string;
  kitKey: string | null;
  versions: number[];
  elements: Map<string, ProjectKitElement>;
}

function reqElementIdMap(snapshot: GostWizardSnapshot | null, kitId: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of Array.isArray(snapshot?.requirements) ? snapshot!.requirements : []) {
    const r = raw as Record<string, unknown>;
    const o = readOrigin(r?.origin);
    if (o && o.kitId === kitId) map.set(String(r.id), o.elementId);
  }
  return map;
}

/** Использование наборов проектом: kitId → элементы с версиями. */
export function collectProjectKitUsage(
  stages: ProjectStageRow[],
  risks: ProjectRiskRow[],
  snapshot: GostWizardSnapshot | null,
): Map<string, ProjectKitUsage> {
  const usage = new Map<string, ProjectKitUsage>();
  const add = (kitId: string, kitKey: string | null, el: ProjectKitElement) => {
    const u: ProjectKitUsage = usage.get(kitId) ?? {
      kitId,
      kitKey: null,
      versions: [],
      elements: new Map(),
    };
    if (kitKey) u.kitKey = kitKey;
    if (!u.versions.includes(el.kitVersion)) u.versions.push(el.kitVersion);
    // Повтор elementId (элемент скопирован вручную) — учитывается первый.
    if (!u.elements.has(el.elementId)) u.elements.set(el.elementId, el);
    usage.set(kitId, u);
  };
  for (const s of stages) {
    const o = s.isApprovalTask ? null : parseOriginRef(s.originRef);
    if (!o) continue;
    add(o.kitId, null, {
      section: 'stages',
      elementId: o.elementId,
      kitVersion: o.kitVersion,
      rowId: s.id,
      values: { name: s.name, role: s.role, hours: s.hours, notes: s.requirements ?? null },
    });
  }
  for (const r of risks) {
    const o = parseOriginRef(r.originRef);
    if (!o) continue;
    add(o.kitId, null, {
      section: 'risks',
      elementId: o.elementId,
      kitVersion: o.kitVersion,
      rowId: r.id,
      values: { description: r.description, hours: r.hours },
    });
  }
  for (const raw of Array.isArray(snapshot?.requirements) ? snapshot!.requirements : []) {
    const r = raw as Record<string, unknown>;
    const o = readOrigin(r?.origin);
    if (!o) continue;
    add(o.kitId, o.kitKey, {
      section: 'requirements',
      elementId: o.elementId,
      kitVersion: o.kitVersion,
      rowId: String(r.id),
      values: {
        code: r.code ?? null,
        category: r.category ?? null,
        title: r.title ?? null,
        description: r.description ?? null,
        criterion: typeof r.kitCriterion === 'string' ? r.kitCriterion : null,
      },
    });
  }
  for (const c of snapshot?.kitChecks ?? []) {
    const o = readOrigin(c.origin);
    if (!o) continue;
    const byId = reqElementIdMap(snapshot, o.kitId);
    add(o.kitId, o.kitKey, {
      section: 'checks',
      elementId: o.elementId,
      kitVersion: o.kitVersion,
      rowId: o.elementId,
      values: {
        criteria: c.criteria,
        method: c.method ?? null,
        requirementIds: c.requirementIds.map((id) => byId.get(id) ?? id),
      },
    });
  }
  for (const f of snapshot?.kitFragments ?? []) {
    const o = readOrigin(f.origin);
    if (!o) continue;
    add(o.kitId, o.kitKey, {
      section: 'fragments',
      elementId: o.elementId,
      kitVersion: o.kitVersion,
      rowId: o.elementId,
      values: { sectionKey: f.sectionKey, title: f.title ?? null, text: f.text },
    });
  }
  for (const u of usage.values()) u.versions.sort((a, b) => a - b);
  return usage;
}

/** Состояние проекта для плана применения того же набора. */
export function existingStateFor(
  usage: ProjectKitUsage | undefined,
  snapshot: GostWizardSnapshot | null,
): ExistingKitState {
  const state: ExistingKitState = {
    presentElementIds: new Set(),
    stageIdByElement: new Map(),
    requirementIdByElement: new Map(),
    snapshotRequirementIds: new Set(
      (Array.isArray(snapshot?.requirements) ? snapshot!.requirements : []).map((r) =>
        String((r as { id?: unknown })?.id),
      ),
    ),
  };
  for (const el of usage?.elements.values() ?? []) {
    state.presentElementIds.add(el.elementId);
    if (el.section === 'stages') state.stageIdByElement.set(el.elementId, el.rowId);
    if (el.section === 'requirements') state.requirementIdByElement.set(el.elementId, el.rowId);
  }
  return state;
}

// ── Значения элементов набора для сравнения ────────────────────────────

const VALID_CATEGORIES = new Set(Object.keys(REQUIREMENT_CATEGORY_LABELS));

/** Значения элемента набора в той же форме, что значения элемента проекта. */
export function kitElementValues(
  content: SolutionKitContent,
  section: UpdateSection,
  elementId: string,
  driverValues: Record<string, number>,
): Values | null {
  switch (section) {
    case 'stages': {
      const s = content.stages.find((x) => x.elementId === elementId);
      return s
        ? {
            name: s.name,
            role: s.role,
            hours: kitStageHours(content, s, driverValues),
            notes: s.notes,
          }
        : null;
    }
    case 'risks': {
      const r = content.risks.find((x) => x.elementId === elementId);
      return r ? { description: r.description, hours: r.hours } : null;
    }
    case 'requirements': {
      const r = content.requirements.find((x) => x.elementId === elementId);
      return r
        ? {
            code: r.code ?? r.elementId,
            category: VALID_CATEGORIES.has(r.category) ? r.category : 'functional',
            title: r.title,
            description: r.description,
            criterion: r.criterion,
          }
        : null;
    }
    case 'checks': {
      const c = content.checks.find((x) => x.elementId === elementId);
      return c
        ? { criteria: c.criteria, method: c.method, requirementIds: [...c.requirementIds] }
        : null;
    }
    case 'fragments': {
      const f = content.fragments.find((x) => x.elementId === elementId);
      return f
        ? {
            sectionKey: resolveTzSectionId(f.sectionKey) ?? f.sectionKey,
            title: f.title,
            text: f.text,
          }
        : null;
    }
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function differingFields(a: Values, b: Values): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => !same(a[k], b[k]))
    .sort();
}

// ── Предложение ─────────────────────────────────────────────────────────

export interface KitUpdateChange {
  elementId: string;
  section: UpdateSection;
  kind: 'added' | 'removed' | 'changed';
  fields: string[];
  /** Версия набора, из которой элемент пришёл в проект (для added — null). */
  projectVersion: number | null;
  project: Values | null;
  kit: Values | null;
  /** Изменился ли элемент в наборе с версии проекта (false — разница от адаптации). */
  kitChanged: boolean;
}

export interface KitUpdateProposal {
  kitId: string;
  kitKey: string;
  toVersion: number;
  projectVersions: number[];
  changes: KitUpdateChange[];
  /** Элементы, совпадающие с новой версией, — переносятся на неё без вопросов. */
  unchanged: string[];
}

const SECTIONS: UpdateSection[] = ['stages', 'risks', 'requirements', 'checks', 'fragments'];

export function buildUpdateProposal(input: {
  kit: { id: string; key: string };
  to: { version: number; content: SolutionKitContent };
  /** Содержимое версий, из которых пришли элементы проекта. */
  versions: Map<number, SolutionKitContent>;
  usage: ProjectKitUsage;
  driverValues: Record<string, number>;
  hasPackage: boolean;
}): KitUpdateProposal {
  const { kit, to, usage, driverValues } = input;
  const changes: KitUpdateChange[] = [];
  const unchanged: string[] = [];
  // «Новый» элемент — которого не было в самой ранней версии, на которой
  // основан проект: исключённое при первом применении снова не предлагается,
  // а отложенное при частичном обновлении предлагается, пока в проекте
  // остаются элементы более ранней версии.
  const base = Math.min(...usage.versions);
  const baseContent = input.versions.get(base);

  for (const el of usage.elements.values()) {
    const kitVals = kitElementValues(to.content, el.section, el.elementId, driverValues);
    if (!kitVals) {
      changes.push({
        elementId: el.elementId,
        section: el.section,
        kind: 'removed',
        fields: [],
        projectVersion: el.kitVersion,
        project: el.values,
        kit: null,
        kitChanged: true,
      });
      continue;
    }
    const fields = differingFields(el.values, kitVals);
    if (fields.length === 0) {
      if (el.kitVersion !== to.version) unchanged.push(el.elementId);
      continue;
    }
    const from = input.versions.get(el.kitVersion);
    const fromVals = from ? kitElementValues(from, el.section, el.elementId, driverValues) : null;
    changes.push({
      elementId: el.elementId,
      section: el.section,
      kind: 'changed',
      fields,
      projectVersion: el.kitVersion,
      project: el.values,
      kit: kitVals,
      kitChanged: !fromVals || differingFields(fromVals, kitVals).length > 0,
    });
  }

  for (const section of SECTIONS) {
    if (section !== 'stages' && section !== 'risks' && !input.hasPackage) continue;
    for (const e of to.content[section]) {
      if (usage.elements.has(e.elementId)) continue;
      const inBase = baseContent
        ? (baseContent[section] as { elementId: string }[]).some((x) => x.elementId === e.elementId)
        : false;
      if (inBase) continue;
      changes.push({
        elementId: e.elementId,
        section,
        kind: 'added',
        fields: [],
        projectVersion: null,
        project: null,
        kit: kitElementValues(to.content, section, e.elementId, driverValues),
        kitChanged: true,
      });
    }
  }

  const order = (c: KitUpdateChange) => SECTIONS.indexOf(c.section);
  changes.sort((a, b) => order(a) - order(b) || a.elementId.localeCompare(b.elementId));
  return {
    kitId: kit.id,
    kitKey: kit.key,
    toVersion: to.version,
    projectVersions: [...usage.versions],
    changes,
    unchanged: unchanged.sort(),
  };
}

// ── Применение выбранных изменений ─────────────────────────────────────

export interface CalculationUpdatePlan {
  primary: PrimaryStageInput[];
  riskUpdates: { id: string; description: string; hours: number; originRef: string }[];
  riskOriginBumps: { id: string; originRef: string }[];
  riskDeletes: string[];
  /** План добавляемых элементов (этапы, риски, требования, проверки, фрагменты). */
  addPlan: ApplicationPlan;
}

/**
 * Изменения расчёта: этапы — новым списком основных этапов для перестройки
 * (обновлённые и перенесённые на новую версию получают новый originRef),
 * риски — точечные операции, добавляемые элементы — планом применения.
 */
export function planCalculationUpdate(input: {
  kit: { id: string; key: string };
  to: { version: number; content: SolutionKitContent };
  proposal: KitUpdateProposal;
  selected: Set<string>;
  usage: ProjectKitUsage;
  stages: ProjectStageRow[];
  risks: ProjectRiskRow[];
  snapshot: GostWizardSnapshot | null;
  driverValues: Record<string, number>;
  hasPackage: boolean;
}): CalculationUpdatePlan {
  const { kit, to, proposal, selected } = input;
  const ref = (elementId: string) =>
    formatOriginRef({ kitId: kit.id, kitVersion: to.version, elementId });
  const change = new Map(
    proposal.changes.filter((c) => selected.has(c.elementId)).map((c) => [c.elementId, c]),
  );
  const bump = new Set(proposal.unchanged);

  const primary: PrimaryStageInput[] = [];
  input.stages.forEach((s, i) => {
    if (s.isApprovalTask) return;
    const next = input.stages[i + 1];
    const approvalDays =
      s.approvalDays ?? (next && next.isApprovalTask ? (next.approvalDays ?? null) : null);
    const o = parseOriginRef(s.originRef);
    const mine = o && o.kitId === kit.id ? o : null;
    const c = mine ? change.get(mine.elementId) : undefined;
    if (c?.kind === 'removed') return;
    const base: PrimaryStageInput = {
      sourceStageId: s.id,
      name: s.name,
      role: s.role,
      hours: s.hours,
      requirements: s.requirements,
      parallel: !!s.parallel,
      approvalDays,
    };
    if (c?.kind === 'changed' && c.kit) {
      primary.push({
        ...base,
        name: String(c.kit.name),
        role: String(c.kit.role),
        hours: Number(c.kit.hours),
        requirements: (c.kit.notes as string | null) ?? null,
        originRef: ref(mine!.elementId),
      });
    } else if (mine && bump.has(mine.elementId)) {
      primary.push({ ...base, originRef: ref(mine.elementId) });
    } else {
      primary.push(base);
    }
  });

  const riskUpdates: CalculationUpdatePlan['riskUpdates'] = [];
  const riskOriginBumps: CalculationUpdatePlan['riskOriginBumps'] = [];
  const riskDeletes: string[] = [];
  for (const r of input.risks) {
    const o = parseOriginRef(r.originRef);
    if (!o || o.kitId !== kit.id) continue;
    const c = change.get(o.elementId);
    if (c?.kind === 'removed') riskDeletes.push(r.id);
    else if (c?.kind === 'changed' && c.kit) {
      riskUpdates.push({
        id: r.id,
        description: String(c.kit.description),
        hours: Number(c.kit.hours),
        originRef: ref(o.elementId),
      });
    } else if (bump.has(o.elementId))
      riskOriginBumps.push({ id: r.id, originRef: ref(o.elementId) });
  }

  // Добавляемые элементы — обычным планом: исключено всё, кроме выбранных added.
  const added = new Set(
    proposal.changes
      .filter((c) => c.kind === 'added' && selected.has(c.elementId))
      .map((c) => c.elementId),
  );
  const allIds = SECTIONS.flatMap((s) =>
    (to.content[s] as { elementId: string }[]).map((e) => e.elementId),
  );
  const existing = existingStateFor(input.usage, input.snapshot);
  const addPlan = buildApplicationPlan({
    kit,
    version: to,
    selection: {
      targets: { calculation: true, package: input.hasPackage },
      excluded: allIds.filter((id) => !added.has(id)),
      overrides: {},
      driverValues: input.driverValues,
    },
    answers: {},
    existing,
  });
  primary.push(
    ...addPlan.stages.map((s) => ({
      name: s.name,
      role: s.role,
      hours: s.hours,
      requirements: s.requirements,
      originRef: s.originRef,
    })),
  );
  return { primary, riskUpdates, riskOriginBumps, riskDeletes, addPlan };
}

/**
 * Изменения снимка комплекта: правка, удаление и перенос на новую версию
 * требований, проверок и фрагментов; добавляемые — из плана; связи по
 * содержимому новой версии для затронутых этапов и требований.
 */
export function applySnapshotUpdate(input: {
  kit: { id: string; key: string };
  to: { version: number; content: SolutionKitContent };
  proposal: KitUpdateProposal;
  selected: Set<string>;
  snapshot: GostWizardSnapshot;
  addPlan: ApplicationPlan;
  /** elementId этапа набора → Stage.id новой версии расчёта. */
  stageIdByElement: Map<string, string>;
  /**
   * Stage.id, существующие в расчёте после перестройки: связи на удалённые
   * этапы (в том числе удалённые обновлением) снимаются.
   */
  liveStageIds?: Set<string>;
}): GostWizardSnapshot {
  const { kit, to, proposal, selected, addPlan } = input;
  const snapshot = JSON.parse(JSON.stringify(input.snapshot)) as GostWizardSnapshot;
  const change = new Map(
    proposal.changes.filter((c) => selected.has(c.elementId)).map((c) => [c.elementId, c]),
  );
  const bump = new Set(proposal.unchanged);
  const origin = (elementId: string) => ({
    kitId: kit.id,
    kitKey: kit.key,
    kitVersion: to.version,
    elementId,
  });

  // Требования.
  const removedReqIds = new Set<string>();
  const reqs = (snapshot.requirements ??= []) as Record<string, unknown>[];
  for (let i = reqs.length - 1; i >= 0; i -= 1) {
    const r = reqs[i];
    const o = readOrigin(r?.origin);
    if (!o || o.kitId !== kit.id) continue;
    const c = change.get(o.elementId);
    if (c?.kind === 'removed' && c.section === 'requirements') {
      removedReqIds.add(String(r.id));
      reqs.splice(i, 1);
    } else if (c?.kind === 'changed' && c.section === 'requirements' && c.kit) {
      Object.assign(r, {
        code: c.kit.code,
        category: c.kit.category,
        title: c.kit.title,
        description: c.kit.description,
        originalText: c.kit.description,
        kitCriterion: c.kit.criterion ?? null,
        sourceFile: `Набор решений ${kit.key} v${to.version}`,
        origin: origin(o.elementId),
      });
    } else if (bump.has(o.elementId)) {
      r.origin = origin(o.elementId);
    }
  }
  const live = input.liveStageIds;
  snapshot.manualLinks = (snapshot.manualLinks ?? []).filter((l) => {
    const link = l as { sourceId?: unknown; targetId?: unknown; targetStageId?: unknown };
    if (removedReqIds.has(String(link.sourceId))) return false;
    const target = (link.targetId ?? link.targetStageId) as string | undefined;
    // Решение «не распределено» (пустая цель) остаётся как есть.
    return !target || !live || live.has(target);
  });
  if (live) {
    for (const r of reqs) {
      if (typeof r?.mappedStageId === 'string' && !live.has(r.mappedStageId)) {
        delete r.mappedStageId;
      }
    }
  }

  const reqIdByElement = new Map<string, string>();
  for (const r of reqs) {
    const o = readOrigin(r?.origin);
    if (o && o.kitId === kit.id) reqIdByElement.set(o.elementId, String(r.id));
  }

  // Проверки.
  const checks: KitCheckEntry[] = [];
  for (const entry of snapshot.kitChecks ?? []) {
    const o = readOrigin(entry.origin);
    if (!o || o.kitId !== kit.id) {
      checks.push(entry);
      continue;
    }
    const c = change.get(o.elementId);
    if (c?.kind === 'removed' && c.section === 'checks') continue;
    let next = {
      ...entry,
      requirementIds: entry.requirementIds.filter((id) => !removedReqIds.has(id)),
    };
    if (c?.kind === 'changed' && c.section === 'checks' && c.kit) {
      next = {
        origin: origin(o.elementId),
        criteria: String(c.kit.criteria),
        method: (c.kit.method as KitCheckEntry['method']) ?? null,
        requirementIds: (c.kit.requirementIds as string[])
          .map((id) => reqIdByElement.get(id))
          .filter((id): id is string => Boolean(id)),
      };
    } else if (bump.has(o.elementId)) {
      next = { ...next, origin: origin(o.elementId) };
    }
    if (next.requirementIds.length > 0) checks.push(next);
  }
  snapshot.kitChecks = checks;

  // Фрагменты.
  for (const entry of [...(snapshot.kitFragments ?? [])]) {
    const o = readOrigin(entry.origin);
    if (!o || o.kitId !== kit.id) continue;
    const c = change.get(o.elementId);
    if (c?.section !== 'fragments' && !bump.has(o.elementId)) continue;
    if (c?.kind === 'removed') removeFragment(snapshot, o.elementId, kit.id);
    else if (c?.kind === 'changed' && c.kit) {
      removeFragment(snapshot, o.elementId, kit.id);
      // Раздел новой версии не найден в схеме — фрагмент снимается, а не висит.
      if (!resolveTzSectionId(String(c.kit.sectionKey))) continue;
      addFragment(snapshot, {
        origin: origin(o.elementId),
        sectionKey: String(c.kit.sectionKey),
        title: (c.kit.title as string | null) ?? null,
        text: String(c.kit.text),
      });
    } else {
      entry.origin = origin(o.elementId);
    }
  }

  // Добавляемые элементы.
  for (const item of addPlan.requirements) {
    reqs.push(JSON.parse(JSON.stringify(item)));
    reqIdByElement.set(item.origin.elementId, item.id);
  }
  for (const c of addPlan.checks) snapshot.kitChecks.push(JSON.parse(JSON.stringify(c)));
  for (const f of addPlan.fragments) addFragment(snapshot, JSON.parse(JSON.stringify(f)));
  recomputeKitCriteria(snapshot);
  if (snapshot.kitChecks.length === 0) delete snapshot.kitChecks;

  // Связи по новой версии для добавленных и изменённых этапов/требований.
  const touched = new Set([
    ...addPlan.stages.map((s) => s.elementId),
    ...addPlan.requirements.map((r) => r.origin.elementId),
    ...[...change.values()].filter((c) => c.kind === 'changed').map((c) => c.elementId),
  ]);
  for (const s of to.content.stages) {
    const stageId = input.stageIdByElement.get(s.elementId);
    if (!stageId) continue;
    for (const reqEl of s.requirementIds) {
      if (!touched.has(s.elementId) && !touched.has(reqEl)) continue;
      const reqId = reqIdByElement.get(reqEl);
      if (reqId) addManualLink(snapshot, reqId, stageId);
    }
  }
  return snapshot;
}

export { kitRequirementId };
