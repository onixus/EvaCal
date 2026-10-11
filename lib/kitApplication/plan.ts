/**
 * План применения версии набора решений к проекту (#103 WP-7b). Чистые
 * функции: одна и та же версия набора, та же адаптация и то же состояние
 * проекта дают один и тот же план (воспроизводимость) — порядок элементов
 * берётся из набора, id требований детерминированы.
 *
 * Адаптация (`KitSelection`): цели (расчёт и/или черновик комплекта),
 * исключённые элементы, правки отдельных полей, значения драйверов.
 * Ссылки не повисают: проверка без выбранных требований не применяется,
 * связь «требование → этап» создаётся, только если в проекте есть оба конца.
 */
import {
  REQUIREMENT_CATEGORY_LABELS,
  type Gost34RequirementItem,
  type RequirementCategory,
} from '@/lib/gost34/types';
import type { KitCheckMethod, SolutionKitContent } from '@/lib/solutionKits/content';
import { formatOriginRef, kitRequirementId, type KitElementOrigin } from './origin';

// ── Адаптация ─────────────────────────────────────────────────────────────

export interface ElementOverride {
  name?: string;
  role?: string;
  hours?: number;
  description?: string;
  title?: string;
  text?: string;
  criteria?: string;
}

export interface KitSelection {
  targets: { calculation: boolean; package: boolean };
  /** Исключённые elementId; остальные элементы применяются. */
  excluded: string[];
  overrides: Record<string, ElementOverride>;
  /** Значения драйверов по ключу поля опросника. */
  driverValues: Record<string, number>;
}

const MAX_LIST = 5_000;
const MAX_TEXT = 20_000;
const MAX_HOURS = 100_000;
const OVERRIDE_TEXT_KEYS = ['name', 'role', 'description', 'title', 'text', 'criteria'] as const;

/** Разбор адаптации из запроса; строка — текст ошибки. */
export function parseSelection(raw: unknown): KitSelection | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'selection: объект';
  const o = raw as Record<string, unknown>;
  const t = (o.targets ?? {}) as Record<string, unknown>;
  const targets = { calculation: t.calculation === true, package: t.package === true };
  if (!targets.calculation && !targets.package) {
    return 'Выберите цель: расчёт и/или черновик комплекта';
  }
  const excluded = o.excluded ?? [];
  if (
    !Array.isArray(excluded) ||
    excluded.length > MAX_LIST ||
    excluded.some((x) => typeof x !== 'string')
  ) {
    return 'excluded: массив elementId';
  }
  const overrides: Record<string, ElementOverride> = {};
  const rawOverrides = o.overrides ?? {};
  if (typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) return 'overrides: объект';
  const entries = Object.entries(rawOverrides as Record<string, unknown>);
  if (entries.length > MAX_LIST) return 'overrides: слишком много правок';
  for (const [elementId, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return `overrides.${elementId}: объект`;
    }
    const v = value as Record<string, unknown>;
    const out: ElementOverride = {};
    for (const key of Object.keys(v)) {
      if (key === 'hours') {
        const h = v.hours;
        if (typeof h !== 'number' || !Number.isFinite(h) || h < 0 || h > MAX_HOURS) {
          return `overrides.${elementId}.hours: число от 0 до ${MAX_HOURS}`;
        }
        out.hours = h;
      } else if ((OVERRIDE_TEXT_KEYS as readonly string[]).includes(key)) {
        const s = v[key];
        if (typeof s !== 'string' || !s.trim() || s.length > MAX_TEXT) {
          return `overrides.${elementId}.${key}: непустая строка до ${MAX_TEXT} символов`;
        }
        out[key as (typeof OVERRIDE_TEXT_KEYS)[number]] = s.trim();
      } else {
        return `overrides.${elementId}.${key}: поле не правится`;
      }
    }
    overrides[elementId] = out;
  }
  const driverValues = parseDriverValues(o.driverValues);
  if (typeof driverValues === 'string') return driverValues;
  return {
    targets,
    excluded: [...new Set(excluded as string[])].sort(),
    overrides,
    driverValues,
  };
}

const MAX_DRIVER = 1e6;
const MAX_DRIVERS = 500;

/** Значения драйверов `{ ключ поля: число 0…1e6 }`; строка — текст ошибки. */
export function parseDriverValues(raw: unknown): Record<string, number> | string {
  const value = raw ?? {};
  if (typeof value !== 'object' || Array.isArray(value)) return 'driverValues: объект';
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_DRIVERS) return 'driverValues: слишком много значений';
  const out: Record<string, number> = {};
  for (const [key, v] of entries) {
    if (
      key.length > 64 ||
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > MAX_DRIVER
    ) {
      return `driverValues.${key.slice(0, 64)}: число от 0 до ${MAX_DRIVER}`;
    }
    out[key] = v;
  }
  return out;
}

/** План ничего не создаёт: применять нечего (повтор или всё исключено). */
export function isEmptyPlan(plan: ApplicationPlan): boolean {
  return (
    plan.stages.length === 0 &&
    plan.risks.length === 0 &&
    plan.requirements.length === 0 &&
    plan.checks.length === 0 &&
    plan.fragments.length === 0 &&
    plan.links.length === 0
  );
}

// ── Часы этапов ─────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Значения драйверов: явные из адаптации, иначе ответы расчёта по ключу поля
 * (нечисловой или пустой ответ — 0, как в `primaryStagesFromTemplate`).
 */
export function resolveDriverValues(
  content: SolutionKitContent,
  answers: Record<string, unknown>,
  explicit: Record<string, number> = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of content.fields) {
    if (f.type !== 'number') continue;
    out[f.key] = f.key in explicit ? explicit[f.key] : Number(answers[f.key] ?? 0) || 0;
  }
  return out;
}

export function kitStageHours(
  content: SolutionKitContent,
  stage: SolutionKitContent['stages'][number],
  driverValues: Record<string, number>,
): number {
  const field = stage.driver ? content.fields.find((f) => f.elementId === stage.driver) : null;
  const units = field ? (driverValues[field.key] ?? 0) : 0;
  return round2(stage.baseHours + stage.hoursPerUnit * units);
}

// ── План ─────────────────────────────────────────────────────────────────

export interface PlannedStage {
  elementId: string;
  originRef: string;
  name: string;
  role: string;
  hours: number;
  requirements: string | null;
}

export interface PlannedRisk {
  elementId: string;
  originRef: string;
  description: string;
  hours: number;
}

/** Требование снимка комплекта из набора (legacy-строка мастера + провенанс). */
export type KitRequirementItem = Gost34RequirementItem & {
  origin: KitElementOrigin;
  /** Критерий самого требования в наборе: база для пересчёта критериев. */
  kitCriterion: string | null;
  verificationMethod?: KitCheckMethod;
  /** Последние значения из набора: правку пользователя пересчёт не затирает. */
  kitAutoCriterion?: string | null;
  kitAutoMethod?: KitCheckMethod | null;
};

export interface KitCheckEntry {
  origin: KitElementOrigin;
  /** id требований снимка. */
  requirementIds: string[];
  criteria: string;
  method: KitCheckMethod | null;
}

export interface KitFragmentEntry {
  origin: KitElementOrigin;
  sectionKey: string;
  title: string | null;
  text: string;
}

export interface PlannedLink {
  requirementElementId: string;
  stageElementId: string;
}

export interface SkippedElement {
  elementId: string;
  reason: 'excluded' | 'already-applied' | 'no-target' | 'requirement-not-selected' | 'id-conflict';
}

export interface ApplicationPlan {
  kit: { id: string; key: string; version: number };
  driverValues: Record<string, number>;
  stages: PlannedStage[];
  risks: PlannedRisk[];
  requirements: KitRequirementItem[];
  checks: KitCheckEntry[];
  fragments: KitFragmentEntry[];
  links: PlannedLink[];
  skipped: SkippedElement[];
}

/** Что из этого набора уже есть в проекте (любой версии). */
export interface ExistingKitState {
  /** elementId элементов набора, уже применённых к проекту. */
  presentElementIds: Set<string>;
  /** elementId этапа набора → Stage.id в расчёте. */
  stageIdByElement: Map<string, string>;
  /** elementId требования набора → id требования в снимке. */
  requirementIdByElement: Map<string, string>;
  /** Все id требований снимка (для конфликтов id). */
  snapshotRequirementIds: Set<string>;
}

export function emptyExistingState(): ExistingKitState {
  return {
    presentElementIds: new Set(),
    stageIdByElement: new Map(),
    requirementIdByElement: new Map(),
    snapshotRequirementIds: new Set(),
  };
}

const VALID_CATEGORIES = new Set(Object.keys(REQUIREMENT_CATEGORY_LABELS));

function category(raw: string): RequirementCategory {
  return (VALID_CATEGORIES.has(raw) ? raw : 'functional') as RequirementCategory;
}

function dedupe(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    const t = s?.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function buildApplicationPlan(input: {
  kit: { id: string; key: string };
  version: { version: number; content: SolutionKitContent };
  selection: KitSelection;
  answers: Record<string, unknown>;
  existing?: ExistingKitState;
}): ApplicationPlan {
  const { kit, version, selection, answers } = input;
  const existing = input.existing ?? emptyExistingState();
  const { content } = version;
  const excluded = new Set(selection.excluded);
  const origin = (elementId: string): KitElementOrigin => ({
    kitId: kit.id,
    kitKey: kit.key,
    kitVersion: version.version,
    elementId,
  });
  const ref = (elementId: string) =>
    formatOriginRef({ kitId: kit.id, kitVersion: version.version, elementId });
  const ov = (elementId: string) => selection.overrides[elementId] ?? {};
  const driverValues = resolveDriverValues(content, answers, selection.driverValues);
  const skipped: SkippedElement[] = [];

  /** Общий фильтр: исключён, уже есть, нет цели. */
  const take = (elementId: string, hasTarget: boolean): boolean => {
    if (excluded.has(elementId)) skipped.push({ elementId, reason: 'excluded' });
    else if (existing.presentElementIds.has(elementId)) {
      skipped.push({ elementId, reason: 'already-applied' });
    } else if (!hasTarget) skipped.push({ elementId, reason: 'no-target' });
    else return true;
    return false;
  };

  const stages: PlannedStage[] = content.stages
    .filter((s) => take(s.elementId, selection.targets.calculation))
    .map((s) => {
      const o = ov(s.elementId);
      return {
        elementId: s.elementId,
        originRef: ref(s.elementId),
        name: o.name ?? s.name,
        role: o.role ?? s.role,
        hours: o.hours ?? kitStageHours(content, s, driverValues),
        requirements: o.description ?? s.notes,
      };
    });

  const risks: PlannedRisk[] = content.risks
    .filter((r) => take(r.elementId, selection.targets.calculation))
    .map((r) => {
      const o = ov(r.elementId);
      return {
        elementId: r.elementId,
        originRef: ref(r.elementId),
        description: o.description ?? r.description,
        hours: o.hours ?? r.hours,
      };
    });

  const requirements: KitRequirementItem[] = [];
  for (const r of content.requirements) {
    if (!take(r.elementId, selection.targets.package)) continue;
    const id = kitRequirementId(kit.key, r.elementId);
    if (existing.snapshotRequirementIds.has(id)) {
      skipped.push({ elementId: r.elementId, reason: 'id-conflict' });
      continue;
    }
    const o = ov(r.elementId);
    const description = o.description ?? r.description;
    const item: KitRequirementItem = {
      id,
      code: r.code ?? r.elementId,
      category: category(r.category),
      title: o.title ?? r.title,
      description,
      originalText: description,
      sourceFile: `Набор решений ${kit.key} v${version.version}`,
      origin: origin(r.elementId),
      kitCriterion: o.criteria ?? r.criterion,
    };
    requirements.push(item);
  }

  /** elementId требования → id в снимке: новые и уже применённые. */
  const reqIdByElement = new Map(existing.requirementIdByElement);
  for (const item of requirements) reqIdByElement.set(item.origin.elementId, item.id);

  const checks: KitCheckEntry[] = [];
  for (const c of content.checks) {
    if (!take(c.elementId, selection.targets.package)) continue;
    const requirementIds = c.requirementIds
      .map((id) => reqIdByElement.get(id))
      .filter((id): id is string => Boolean(id));
    if (requirementIds.length === 0) {
      skipped.push({ elementId: c.elementId, reason: 'requirement-not-selected' });
      continue;
    }
    checks.push({
      origin: origin(c.elementId),
      requirementIds,
      criteria: ov(c.elementId).criteria ?? c.criteria,
      method: c.method,
    });
  }

  const fragments: KitFragmentEntry[] = content.fragments
    .filter((f) => take(f.elementId, selection.targets.package))
    .map((f) => {
      const o = ov(f.elementId);
      return {
        origin: origin(f.elementId),
        sectionKey: f.sectionKey,
        title: o.title ?? f.title,
        text: o.text ?? f.text,
      };
    });

  // Связи «требование → этап» — только между элементами, которые в проекте есть.
  const stagePresent = new Set([
    ...stages.map((s) => s.elementId),
    ...existing.stageIdByElement.keys(),
  ]);
  const newStages = new Set(stages.map((s) => s.elementId));
  const newReqs = new Set(requirements.map((r) => r.origin.elementId));
  const links: PlannedLink[] = [];
  for (const s of content.stages) {
    if (!stagePresent.has(s.elementId)) continue;
    for (const reqElementId of s.requirementIds) {
      if (!reqIdByElement.has(reqElementId)) continue;
      // Связь между двумя уже существующими элементами уже была создана раньше.
      if (!newStages.has(s.elementId) && !newReqs.has(reqElementId)) continue;
      links.push({ requirementElementId: reqElementId, stageElementId: s.elementId });
    }
  }

  return {
    kit: { id: kit.id, key: kit.key, version: version.version },
    driverValues,
    stages,
    risks,
    requirements,
    checks,
    fragments,
    links,
    skipped,
  };
}

export { dedupe as dedupeCriteria };
