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
 * Источник связей — снимок базового комплекта (`manualLinks` и legacy
 * `mappedStageId` требований). Часы этапов возвращаются только как контекст:
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

function requirementList(snapshot: unknown): RawRecord[] {
  const reqs = (snapshot as { requirements?: unknown } | null)?.requirements;
  return Array.isArray(reqs)
    ? reqs.filter((r): r is RawRecord => !!r && typeof r === 'object')
    : [];
}

function requirementId(r: RawRecord): string {
  return str(r.id) || str(r.key);
}

/** Текст требования, которым его видит заказчик: нормализованный, иначе исходный. */
function requirementText(r: RawRecord): string {
  return (
    str(r.normalizedText).trim() ||
    str(r.description).trim() ||
    str(r.originalText).trim() ||
    str(r.text).trim() ||
    str(r.title).trim()
  );
}

/** Требования базового комплекта в виде, пригодном для выбора и снимка. */
export function requirementsFromSnapshot(snapshot: unknown): AffectedRequirement[] {
  const seen = new Set<string>();
  const out: AffectedRequirement[] = [];
  for (const r of requirementList(snapshot)) {
    const id = requirementId(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, code: str(r.code) || id, text: requirementText(r) });
  }
  return out;
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

/** Связи «требование → этап» из снимка: ручные решения и legacy-привязка. */
export function traceLinksFromSnapshot(
  snapshot: unknown,
): Array<{ requirementId: string; stageId: string }> {
  const out: Array<{ requirementId: string; stageId: string }> = [];
  const seen = new Set<string>();
  const push = (requirementId: string, stageId: string) => {
    if (!requirementId || !stageId) return;
    const key = `${requirementId}->${stageId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ requirementId, stageId });
  };
  const links = (snapshot as { manualLinks?: unknown } | null)?.manualLinks;
  if (Array.isArray(links)) {
    for (const link of links) {
      if (!link || typeof link !== 'object') continue;
      const l = link as RawRecord;
      // TraceLink { sourceId, targetId }; старые снимки — { sourceId, targetStageId }.
      // Связь без цели — решение «намеренно не распределено», этапа нет.
      push(str(l.sourceId), str(l.targetId) || str(l.targetStageId));
    }
  }
  for (const r of requirementList(snapshot)) {
    push(requirementId(r), str(r.mappedStageId));
  }
  return out;
}

function checksFromSnapshot(snapshot: unknown, ids: Set<string>): ImpactCheck[] {
  const checks: ImpactCheck[] = [];
  for (const r of requirementList(snapshot)) {
    const id = requirementId(r);
    if (!ids.has(id)) continue;
    const criteria = Array.isArray(r.acceptanceCriteria)
      ? r.acceptanceCriteria.filter((c): c is string => typeof c === 'string')
      : str(r.criterion)
          .split(';')
          .map((c) => c.trim());
    for (const criterion of criteria) {
      if (!criterion.trim()) continue;
      checks.push({
        requirementId: id,
        code: str(r.code) || id,
        criterion: criterion.trim(),
        source: 'requirement-criterion',
      });
    }
  }
  return checks;
}

export interface ImpactInput {
  calculation: { id: string; version: number; currency: string };
  stages: Array<{
    id: string;
    name: string;
    role: string;
    hours: number;
    isApprovalTask?: boolean;
  }>;
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

  const stageReqs = new Map<string, string[]>();
  const linked = new Set<string>();
  for (const link of traceLinksFromSnapshot(snapshot)) {
    if (!ids.has(link.requirementId)) continue;
    linked.add(link.requirementId);
    const list = stageReqs.get(link.stageId) ?? [];
    if (!list.includes(link.requirementId)) list.push(link.requirementId);
    stageReqs.set(link.stageId, list);
  }

  const stages: ImpactStage[] = [];
  for (const [stageId, requirementIds] of stageReqs) {
    const stage = stageById.get(stageId);
    stages.push(
      stage
        ? {
            id: stage.id,
            name: stage.name,
            role: stage.role,
            baseHours: stage.hours,
            requirementIds,
          }
        : { id: stageId, name: '', role: '', baseHours: null, requirementIds, missing: true },
    );
  }
  // Порядок этапов — как в расчёте; отсутствующие в расчёте — в конце.
  const order = new Map(input.stages.map((s, i) => [s.id, i]));
  stages.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );

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
