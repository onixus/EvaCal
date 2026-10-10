import { fromGost34RequirementItem } from '@/lib/gost34/requirements/adapters';
import {
  getRequirementEffectiveText,
  type Gost34RequirementV2,
} from '@/lib/gost34/requirements/v2';
import { buildTraceability } from '@/lib/gost34/traceability/engine';
import type { TraceLink } from '@/lib/gost34/traceability/types';
import type { Gost34RequirementItem, Gost34StageItem } from '@/lib/gost34/types';
import type {
  AffectedRequirement,
  ChangeImpact,
  ImpactCheck,
  ImpactDocument,
  ImpactStage,
} from './types';

/**
 * Связанные с запросом работы, документы и проверки.
 *
 * Связи «требование → этап» строятся тем же движком, что и трассировка
 * выпущенного комплекта (`buildTraceability`): ручные решения снимка
 * (`manualLinks`, включая «намеренно не распределено») главнее, остальные
 * требования связываются правилами (RULE), legacy `mappedStageId` — только
 * запасной вариант для требований без ручного решения. Часы этапов возвращаются только как контекст:
 * связь требования с этапом не значит, что меняются все часы этапа, поэтому
 * здесь нет ни суммы часов, ни стоимости, ни срока — их явно вводит специалист
 * (см. `parseEstimateInput`). Это прямое требование приёмки #103 §1.
 */

const DOCUMENT_LABELS: Record<string, string> = {
  tz: 'Техническое задание',
  pz: 'Пояснительная записка',
  af: 'Описание автоматизируемых функций',
  pmi: 'Программа и методика испытаний',
  spec: 'Спецификация оборудования',
  rp: 'Руководство пользователя',
  ra: 'Руководство администратора',
  psi: 'Протокол испытаний',
  act: 'Акт приёмки',
  zip: 'Полный комплект',
};

export function documentLabel(type: string): string {
  return DOCUMENT_LABELS[type.toLowerCase()] ?? type.toUpperCase();
}

type RawRecord = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Требования снимка в модели v2 — как их нормализует генератор комплекта.
 * Снимок хранит legacy-элементы (`Gost34RequirementItem`); уже v2-объекты
 * (с `approval`) принимаются как есть. Элементы без id пропускаются.
 */
function snapshotRequirements(
  snapshot: unknown,
): Array<{ v2: Gost34RequirementV2; raw: RawRecord }> {
  const reqs = (snapshot as { requirements?: unknown } | null)?.requirements;
  if (!Array.isArray(reqs)) return [];
  const seen = new Set<string>();
  const out: Array<{ v2: Gost34RequirementV2; raw: RawRecord }> = [];
  for (const r of reqs) {
    if (!r || typeof r !== 'object') continue;
    const raw = r as RawRecord;
    const id = str(raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const v2 =
      'approval' in raw && raw.approval && typeof raw.approval === 'object'
        ? ({
            ...(raw as unknown as Gost34RequirementV2),
            originalText: str(raw.originalText),
          } as Gost34RequirementV2)
        : fromGost34RequirementItem({
            ...(raw as unknown as Gost34RequirementItem),
            code: str(raw.code),
            title: str(raw.title),
            description: str(raw.description) || str(raw.originalText),
          });
    out.push({ v2, raw });
  }
  return out;
}

/**
 * Требования базового комплекта в виде, пригодном для выбора и снимка. Текст —
 * действующая редакция (`getRequirementEffectiveText`): нормализованная только
 * после утверждения, иначе исходная.
 */
export function requirementsFromSnapshot(snapshot: unknown): AffectedRequirement[] {
  return snapshotRequirements(snapshot).map(({ v2 }) => ({
    id: v2.id,
    code: v2.code || v2.id,
    text: getRequirementEffectiveText(v2) || v2.title || '',
  }));
}

/**
 * Снимок затронутых требований. Неизвестный id — ошибка вызывающего: выбирать
 * можно только требования базового комплекта.
 */
export function snapshotAffectedRequirements(
  snapshot: unknown,
  ids: string[],
): { requirements: AffectedRequirement[]; unknownIds: string[] } {
  const byId = new Map(requirementsFromSnapshot(snapshot).map((r) => [r.id, r]));
  const requirements: AffectedRequirement[] = [];
  const unknownIds: string[] = [];
  for (const id of ids) {
    const req = byId.get(id);
    if (req) requirements.push(req);
    else unknownIds.push(id);
  }
  return { requirements, unknownIds };
}

/** Ручные решения снимка в формате TraceLink; старые снимки — `targetStageId`. */
function manualDecisions(snapshot: unknown): TraceLink[] {
  const links = (snapshot as { manualLinks?: unknown } | null)?.manualLinks;
  if (!Array.isArray(links)) return [];
  const out: TraceLink[] = [];
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const l = link as RawRecord;
    const sourceId = str(l.sourceId);
    if (!sourceId) continue;
    out.push({
      sourceId,
      // Пустая цель — решение «намеренно не распределено», движок его уважает.
      targetId: str(l.targetId) || str(l.targetStageId),
      method: l.method === 'RULE' || l.method === 'LLM' ? l.method : 'MANUAL',
      approved: l.approved !== false,
      ...(typeof l.confidence === 'number' ? { confidence: l.confidence } : {}),
    });
  }
  return out;
}

export interface ImpactStageInput {
  id: string;
  name: string;
  role: string;
  hours: number;
  order?: number;
  requirements?: string | null;
  isApprovalTask?: boolean;
}

/** Этапы так же, как их видит генератор (`normalizeStages`). */
function engineStages(stages: ImpactStageInput[]): Gost34StageItem[] {
  return stages.map((s, idx) => ({
    id: s.id,
    order: s.order ?? idx + 1,
    name: s.name || `Этап ${idx + 1}`,
    role: s.role || 'разработчик',
    hours: s.hours || 0,
    requirements: s.requirements || undefined,
  }));
}

/**
 * Связи «требование → этап» по снимку и этапам базового расчёта — результат
 * того же `buildTraceability`, что и в выпущенном комплекте.
 */
export function traceLinksFromSnapshot(snapshot: unknown, stages: ImpactStageInput[]): TraceLink[] {
  const requirements = snapshotRequirements(snapshot);
  const engine = engineStages(stages);
  const stageIds = new Set(engine.map((s) => s.id));
  const manual = manualDecisions(snapshot);
  const decided = new Set(manual.map((l) => l.sourceId));
  // Legacy mappedStageId — запасной вариант, только без ручного решения.
  const legacy: TraceLink[] = requirements.flatMap(({ raw, v2 }) => {
    const mapped = str(raw.mappedStageId);
    if (!mapped || decided.has(v2.id) || !stageIds.has(mapped)) return [];
    return [{ sourceId: v2.id, targetId: mapped, method: 'MANUAL' as const, approved: true }];
  });
  return buildTraceability(
    requirements.map((r) => r.v2),
    engine,
    [...manual, ...legacy],
  ).links;
}

function checksFromSnapshot(snapshot: unknown, ids: Set<string>): ImpactCheck[] {
  const checks: ImpactCheck[] = [];
  for (const { v2 } of snapshotRequirements(snapshot)) {
    if (!ids.has(v2.id)) continue;
    const criteria = (v2.acceptanceCriteria ?? []).flatMap((c) => c.split(';'));
    for (const criterion of criteria) {
      if (!criterion.trim()) continue;
      checks.push({
        requirementId: v2.id,
        code: v2.code || v2.id,
        criterion: criterion.trim(),
        source: 'requirement-criterion',
      });
    }
  }
  return checks;
}

export interface ImpactInput {
  calculation: { id: string; version: number; currency: string };
  /** Все этапы базового расчёта в порядке Ганта, как их получает генератор. */
  stages: ImpactStageInput[];
  basePackage: {
    id: string;
    version: number;
    documentTypes: string[];
    snapshot: unknown;
  } | null;
  requirementIds: string[];
  now?: Date;
}

export function computeChangeImpact(input: ImpactInput): ChangeImpact {
  const ids = new Set(input.requirementIds);
  const snapshot = input.basePackage?.snapshot ?? null;
  const stageById = new Map(input.stages.map((s) => [s.id, s]));

  const stageReqs = new Map<string, { all: string[]; rule: string[] }>();
  const linked = new Set<string>();
  for (const link of traceLinksFromSnapshot(snapshot, input.stages)) {
    if (!ids.has(link.sourceId) || !stageById.has(link.targetId)) continue;
    linked.add(link.sourceId);
    const entry = stageReqs.get(link.targetId) ?? { all: [], rule: [] };
    if (!entry.all.includes(link.sourceId)) entry.all.push(link.sourceId);
    if (link.method === 'RULE' && !entry.rule.includes(link.sourceId)) {
      entry.rule.push(link.sourceId);
    }
    stageReqs.set(link.targetId, entry);
  }

  const order = new Map(input.stages.map((s, i) => [s.id, i]));
  const stages: ImpactStage[] = Array.from(stageReqs.entries())
    .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map(([stageId, entry]) => {
      const stage = stageById.get(stageId)!;
      return {
        id: stage.id,
        name: stage.name,
        role: stage.role,
        baseHours: stage.hours,
        requirementIds: entry.all,
        ruleRequirementIds: entry.rule,
      };
    });

  const documents: ImpactDocument[] =
    ids.size > 0 && input.basePackage
      ? Array.from(new Set(input.basePackage.documentTypes.map((t) => t.toLowerCase()))).map(
          (type) => ({ type, label: documentLabel(type) }),
        )
      : [];

  return {
    base: {
      calculationId: input.calculation.id,
      calculationVersion: input.calculation.version,
      currency: input.calculation.currency,
      packageId: input.basePackage?.id ?? null,
      packageVersion: input.basePackage?.version ?? null,
    },
    stages,
    documents,
    checks: checksFromSnapshot(snapshot, ids),
    unlinkedRequirementIds: input.requirementIds.filter((id) => !linked.has(id)),
    computedAt: (input.now ?? new Date()).toISOString(),
  };
}
