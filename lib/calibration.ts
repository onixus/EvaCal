/**
 * Калибровка оценки по похожим проектам (reference-class forecasting).
 *
 * Идея: формула шаблона даёт «сырую» оценку по ответам опросника, а архитектор
 * потом правит этапы, добавляет риски — и утверждённый расчёт расходится с
 * формулой. Если посмотреть на уже утверждённые расчёты того же шаблона с
 * похожими ответами, можно заранее показать пресейлу и архитектору, насколько
 * обычно «уезжает» такая оценка: в целом, по этапам и по срокам.
 *
 * Чистая логика без Prisma: сюда приходят строки, отсюда уходит готовый отчёт.
 * Загрузка данных — в `lib/calibrationData.ts`.
 */
import { computePmHours } from './pm';
import { COMPLEXITY_OPTIONS } from './pm';
import { median, round1, round2 } from './stats';

// ---------------------------------------------------------------------------
// Входные строки
// ---------------------------------------------------------------------------

export interface CalibrationField {
  key: string;
  label: string;
  type: string; // text | number | select | checkbox | textarea | complexity
  options: string | null; // JSON-массив строк для select
}

export interface CalibrationStageTemplate {
  name: string;
  role: string;
  baseHours: number;
  hoursPerUnit: number;
  driverFieldKey: string | null;
  order: number;
}

export interface CalibrationStageRow {
  name: string;
  hours: number;
  isApprovalTask: boolean;
  startDate: Date;
  endDate: Date;
  /** Факт по этапу выигранной версии (Horizon E1); отсутствует у остальных. */
  actualHours?: number | null;
}

export interface CalibrationCalcRow {
  id: string;
  name: string;
  customer: string;
  projectId: string | null;
  version: number;
  status: string;
  answers: Record<string, unknown>;
  pmHours: number;
  stages: CalibrationStageRow[];
  risks: { hours: number }[];
  updatedAt: Date;
  /** Версия, по которой выиграна сделка: её факт — третий слой калибровки. */
  wonVersion?: boolean;
}

export interface CalibrationInput {
  target: CalibrationCalcRow;
  fields: CalibrationField[];
  stageTemplates: CalibrationStageTemplate[];
  /** Утверждённые расчёты того же шаблона (может включать и сам target — отфильтруем). */
  candidates: CalibrationCalcRow[];
  /** Показывать ли названия и заказчиков соседей. Для гостей по share-ссылке — нет. */
  revealIdentity: boolean;
  /**
   * Вся цепочка версий целевого расчёта, включая его самого: предки и потомки
   * по parentCalculationId. Собирается в `lib/calibrationData.ts` — здесь её
   * вывести нельзя, промежуточные версии могут быть неутверждёнными и в
   * candidates не попадать.
   */
  lineageIds?: string[];
  /** Сколько соседей брать. */
  k?: number;
}

// ---------------------------------------------------------------------------
// Результат
// ---------------------------------------------------------------------------

export interface AnswerMatch {
  key: string;
  label: string;
  /** Насколько ответ соседа близок к целевому, 0..1 (1 — совпадает). */
  closeness: number;
  targetValue: string;
  neighbourValue: string;
}

export interface Neighbour {
  id: string;
  /** Название расчёта или обезличенный ярлык. */
  label: string;
  customer: string | null;
  version: number;
  /** Похожесть ответов опросника, 0..1. */
  similarity: number;
  /** Часы по формуле шаблона для ответов соседа. */
  formulaHours: number;
  /** Утверждённый итог (этапы + РП + риски). */
  actualHours: number;
  /** actual / formula; null, если формула дала 0. */
  ratio: number | null;
  /**
   * Факт часов по выигранной версии (только этапы с внесённым фактом) и
   * коэффициент факт / утверждено по тем же этапам; null — факта нет.
   */
  realHours: number | null;
  realRatio: number | null;
  /** Календарная длительность утверждённого плана, дней. */
  durationDays: number;
  riskHours: number;
  approvedAt: string;
  answers: AnswerMatch[];
}

export interface StageAdjustment {
  name: string;
  /** Часы этапа по формуле для целевого расчёта. */
  targetFormulaHours: number;
  /** Медиана коэффициента (утверждено / формула) у соседей. */
  medianRatio: number;
  /** Сколько соседей содержат этот этап. */
  samples: number;
  /** Что получится, если применить медиану к целевому расчёту. */
  suggestedHours: number;
}

export type CalibrationConfidence = 'none' | 'low' | 'medium' | 'high';

export interface CalibrationReport {
  /** Текущее состояние целевого расчёта. */
  target: {
    formulaHours: number;
    currentHours: number;
    /** Насколько текущий расчёт уже отличается от формулы. */
    currentRatio: number | null;
  };
  /** Сколько утверждённых расчётов шаблона рассматривалось (после фильтров). */
  poolSize: number;
  neighbours: Neighbour[];
  /** Медиана коэффициента соседей; null — соседей нет. */
  medianRatio: number | null;
  /** Разброс коэффициентов по соседям. */
  ratioRange: { min: number; max: number } | null;
  /**
   * Третий слой: медиана (факт / утверждено) у соседей с фактом, и сколько их.
   * null — ни у одного соседа факта нет.
   */
  medianRealRatio: number | null;
  realSamples: number;
  /** Формула target × медиана. */
  calibratedHours: number | null;
  /** Диапазон часов: формула × min..max. */
  calibratedRange: { min: number; max: number } | null;
  /** Медиана календарной длительности соседей, дней. */
  medianDurationDays: number | null;
  /** Медиана доли рисков в итоге у соседей, 0..1. */
  medianRiskShare: number | null;
  stageAdjustments: StageAdjustment[];
  confidence: CalibrationConfidence;
  /** Человеческое пояснение уровня уверенности. */
  confidenceNote: string;
}

/** Меньше стольких соседей — «низкая» уверенность. */
export const MIN_NEIGHBOURS = 3;
export const DEFAULT_K = 5;
/** Соседи с похожестью ниже порога не учитываются вовсе. */
export const MIN_SIMILARITY = 0.35;

// ---------------------------------------------------------------------------
// Вспомогательные
// ---------------------------------------------------------------------------

function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function displayValue(v: unknown): string {
  if (isBlank(v)) return '—';
  if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
  return String(v);
}

/** Часы по формуле шаблона: сумма этапов + надбавка РП. Копия логики `lib/calc.ts` без Prisma. */
export function formulaBreakdown(
  stageTemplates: CalibrationStageTemplate[],
  fields: { key: string; type: string }[],
  answers: Record<string, unknown>,
): {
  stages: { name: string; hours: number }[];
  stagesHours: number;
  pmHours: number;
  total: number;
} {
  const stages = [...stageTemplates]
    .sort((a, b) => a.order - b.order)
    .map((st) => {
      const driver = st.driverFieldKey ? Number(answers[st.driverFieldKey] ?? 0) || 0 : 0;
      return { name: st.name, hours: Math.max(0, st.baseHours + st.hoursPerUnit * driver) };
    });
  const stagesHours = stages.reduce((s, x) => s + x.hours, 0);
  const pmHours = computePmHours(fields, answers, stagesHours);
  return { stages, stagesHours, pmHours, total: round1(stagesHours + pmHours) };
}

export function grandTotal(row: CalibrationCalcRow): number {
  const stages = row.stages.filter((s) => !s.isApprovalTask).reduce((s, x) => s + x.hours, 0);
  const risks = row.risks.reduce((s, r) => s + r.hours, 0);
  return round1(stages + row.pmHours + risks);
}

export function durationDays(stages: CalibrationStageRow[]): number {
  if (stages.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of stages) {
    min = Math.min(min, s.startDate.getTime());
    max = Math.max(max, s.endDate.getTime());
  }
  return Math.max(0, Math.round((max - min) / (24 * 60 * 60 * 1000)));
}

/**
 * Факт / утверждено по этапам соседа, у которых внесён факт. Считается только
 * для выигранной версии: у остальных факт не ведётся. Этапы без факта не
 * входят в знаменатель — иначе частичный факт выглядел бы как экономия.
 */
export function realRatioOf(row: CalibrationCalcRow): {
  hours: number | null;
  ratio: number | null;
} {
  if (!row.wonVersion) return { hours: null, ratio: null };
  let planned = 0;
  let actual = 0;
  for (const s of row.stages) {
    if (s.isApprovalTask || s.actualHours === null || s.actualHours === undefined) continue;
    planned += s.hours;
    actual += s.actualHours;
  }
  if (planned <= 0) return { hours: null, ratio: null };
  return { hours: round1(actual), ratio: round2(actual / planned) };
}

// ---------------------------------------------------------------------------
// Похожесть ответов (расстояние Гауэра)
// ---------------------------------------------------------------------------

interface FieldScale {
  field: CalibrationField;
  /** Для number: размах значений по пулу; для select/complexity: список опций. */
  range: number;
  options: string[];
}

/** Поля, по которым имеет смысл сравнивать: свободный текст не участвует. */
export function comparableFields(fields: CalibrationField[]): CalibrationField[] {
  return fields.filter((f) => ['number', 'select', 'checkbox', 'complexity'].includes(f.type));
}

function buildScales(fields: CalibrationField[], rows: Record<string, unknown>[]): FieldScale[] {
  return comparableFields(fields).map((field) => {
    if (field.type === 'number') {
      const nums = rows.map((r) => Number(r[field.key])).filter((n) => Number.isFinite(n));
      const range = nums.length ? Math.max(...nums) - Math.min(...nums) : 0;
      return { field, range, options: [] };
    }
    const options =
      field.type === 'complexity' ? [...COMPLEXITY_OPTIONS] : parseOptions(field.options);
    return { field, range: 0, options };
  });
}

/** Близость двух ответов по одному полю, 0..1; null — сравнивать нечего. */
export function fieldCloseness(scale: FieldScale, a: unknown, b: unknown): number | null {
  const { field } = scale;
  if (isBlank(a) && isBlank(b)) return null;
  if (isBlank(a) || isBlank(b)) return 0;

  switch (field.type) {
    case 'number': {
      const x = Number(a);
      const y = Number(b);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
      if (scale.range <= 0) return x === y ? 1 : 0;
      return 1 - Math.min(1, Math.abs(x - y) / scale.range);
    }
    case 'checkbox':
      return Boolean(a) === Boolean(b) ? 1 : 0;
    case 'complexity':
    case 'select': {
      const sa = String(a);
      const sb = String(b);
      if (sa === sb) return 1;
      // Порядковые опции (Простой < Средний < Сложный): соседние ближе, чем крайние.
      const ia = scale.options.indexOf(sa);
      const ib = scale.options.indexOf(sb);
      if (field.type === 'complexity' && ia >= 0 && ib >= 0 && scale.options.length > 1) {
        return 1 - Math.abs(ia - ib) / (scale.options.length - 1);
      }
      return 0;
    }
    default:
      return null;
  }
}

function similarityBetween(
  scales: FieldScale[],
  target: Record<string, unknown>,
  other: Record<string, unknown>,
): { similarity: number; matches: AnswerMatch[] } {
  const matches: AnswerMatch[] = [];
  let sum = 0;
  let n = 0;
  for (const scale of scales) {
    const c = fieldCloseness(scale, target[scale.field.key], other[scale.field.key]);
    if (c === null) continue;
    sum += c;
    n += 1;
    matches.push({
      key: scale.field.key,
      label: scale.field.label,
      closeness: round2(c),
      targetValue: displayValue(target[scale.field.key]),
      neighbourValue: displayValue(other[scale.field.key]),
    });
  }
  return { similarity: n === 0 ? 0 : sum / n, matches };
}

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------

function confidenceFor(neighbours: Neighbour[]): { level: CalibrationConfidence; note: string } {
  if (neighbours.length === 0) {
    return {
      level: 'none',
      note: 'Утверждённых расчётов с похожими ответами по этому шаблону пока нет.',
    };
  }
  const meanSim = neighbours.reduce((s, n) => s + n.similarity, 0) / neighbours.length;
  if (neighbours.length < MIN_NEIGHBOURS) {
    return {
      level: 'low',
      note: `Всего ${neighbours.length} похожих проекта — ориентир, а не норматив.`,
    };
  }
  if (meanSim >= 0.75) {
    return {
      level: 'high',
      note: `${neighbours.length} утверждённых проектов с близкими ответами (средняя похожесть ${Math.round(meanSim * 100)}%).`,
    };
  }
  return {
    level: 'medium',
    note: `${neighbours.length} проектов, но ответы совпадают лишь частично (средняя похожесть ${Math.round(meanSim * 100)}%).`,
  };
}

export function buildCalibration(input: CalibrationInput): CalibrationReport {
  const { target, fields, stageTemplates, revealIdentity } = input;
  const k = input.k ?? DEFAULT_K;

  // Свои версии и всё из того же проекта — не «похожие проекты», а тот же самый.
  //
  // Отсечения по projectId недостаточно: привязка к проекту необязательна, и у
  // расчёта без неё projectId === null. Тогда условие по проекту истинно для
  // всех кандидатов, и собственные утверждённые версии проходят фильтр. Ответы
  // у них те же, похожесть около единицы — они занимают весь top-k и вытесняют
  // настоящих соседей, после чего калибровка показывает не референс-класс, а
  // собственную историю расчёта и подтверждает сама себя.
  //
  // Поэтому цепочка версий отсекается явно, по parentCalculationId.
  const lineage = new Set(input.lineageIds ?? []);
  const pool = input.candidates.filter(
    (c) =>
      c.id !== target.id &&
      !lineage.has(c.id) &&
      c.status === 'approved' &&
      (target.projectId === null || c.projectId !== target.projectId),
  );

  const targetFormula = formulaBreakdown(stageTemplates, fields, target.answers);
  const currentHours = grandTotal(target);

  const scales = buildScales(fields, [target.answers, ...pool.map((c) => c.answers)]);

  const scored = pool
    .map((c) => {
      const { similarity, matches } = similarityBetween(scales, target.answers, c.answers);
      return { row: c, similarity, matches };
    })
    .filter((x) => x.similarity >= MIN_SIMILARITY)
    .sort(
      (a, b) =>
        b.similarity - a.similarity || b.row.updatedAt.getTime() - a.row.updatedAt.getTime(),
    )
    .slice(0, k);

  const neighbours: Neighbour[] = scored.map((x, i) => {
    const f = formulaBreakdown(stageTemplates, fields, x.row.answers);
    const actual = grandTotal(x.row);
    const riskHours = x.row.risks.reduce((s, r) => s + r.hours, 0);
    const real = realRatioOf(x.row);
    return {
      id: x.row.id,
      label: revealIdentity ? x.row.name : `Похожий проект №${i + 1}`,
      customer: revealIdentity ? x.row.customer : null,
      version: x.row.version,
      similarity: round2(x.similarity),
      formulaHours: f.total,
      actualHours: actual,
      ratio: f.total > 0 ? round2(actual / f.total) : null,
      realHours: real.hours,
      realRatio: real.ratio,
      durationDays: durationDays(x.row.stages),
      riskHours: round1(riskHours),
      approvedAt: x.row.updatedAt.toISOString(),
      answers: x.matches,
    };
  });

  const ratios = neighbours.map((n) => n.ratio).filter((r): r is number => r !== null);
  const medianRatio = median(ratios);
  const ratioRange =
    ratios.length > 0 ? { min: Math.min(...ratios), max: Math.max(...ratios) } : null;

  const calibratedHours =
    medianRatio !== null && targetFormula.total > 0
      ? round1(targetFormula.total * medianRatio)
      : null;
  const calibratedRange =
    ratioRange && targetFormula.total > 0
      ? {
          min: round1(targetFormula.total * ratioRange.min),
          max: round1(targetFormula.total * ratioRange.max),
        }
      : null;

  const realRatios = neighbours.map((n) => n.realRatio).filter((r): r is number => r !== null);
  const medianRealRatio = median(realRatios);

  const medianDurationDays = median(neighbours.map((n) => n.durationDays));
  const medianRiskShare = median(
    neighbours.filter((n) => n.actualHours > 0).map((n) => round2(n.riskHours / n.actualHours)),
  );

  // Поэтапная поправка: этапы сопоставляются по имени. В шаблоне одно имя
  // может встречаться несколько раз (разные роли) — складываем в одну строку.
  const sumByName = (rows: { name: string; hours: number }[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.name, (m.get(r.name) ?? 0) + r.hours);
    return m;
  };
  const targetByStage = sumByName(targetFormula.stages);
  const neighbourFormulas = scored.map((x) =>
    sumByName(formulaBreakdown(stageTemplates, fields, x.row.answers).stages),
  );
  const neighbourActuals = scored.map((x) =>
    sumByName(x.row.stages.filter((s) => !s.isApprovalTask)),
  );
  const stageAdjustments: StageAdjustment[] = [];
  for (const [name, targetHours] of targetByStage) {
    const stageRatios: number[] = [];
    scored.forEach((_, i) => {
      const f = neighbourFormulas[i].get(name) ?? 0;
      const a = neighbourActuals[i].get(name);
      // Обнулённый этап (есть в плане, 0 часов) — это ответ «столько и нужно»,
      // и коэффициент 0 для медианы законен: раньше такие наблюдения отбрасывал
      // фильтр a > 0, и самый сильный сигнал «этап не нужен» терялся.
      //
      // Отсутствующий этап (undefined) — другое дело: имя этапа редактируемо,
      // поэтому пропажу нельзя отличить от переименования, и считать её нулём
      // значило бы выдумывать данные. Такие наблюдения по-прежнему не входят
      // в медиану, но их недобор виден по samples рядом с числом соседей.
      if (f > 0 && a !== undefined) stageRatios.push(a / f);
    });
    const m = median(stageRatios);
    if (m === null) continue;
    stageAdjustments.push({
      name,
      targetFormulaHours: round1(targetHours),
      medianRatio: round2(m),
      samples: stageRatios.length,
      suggestedHours: round1(targetHours * m),
    });
  }

  const conf = confidenceFor(neighbours);

  return {
    target: {
      formulaHours: targetFormula.total,
      currentHours,
      currentRatio: targetFormula.total > 0 ? round2(currentHours / targetFormula.total) : null,
    },
    poolSize: pool.length,
    neighbours,
    medianRatio: medianRatio === null ? null : round2(medianRatio),
    ratioRange,
    medianRealRatio: medianRealRatio === null ? null : round2(medianRealRatio),
    realSamples: realRatios.length,
    calibratedHours,
    calibratedRange,
    medianDurationDays,
    medianRiskShare,
    stageAdjustments,
    confidence: conf.level,
    confidenceNote: conf.note,
  };
}
