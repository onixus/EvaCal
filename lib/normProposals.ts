/**
 * Предложения изменить нормативы этапов шаблона по факту (#103 WP-6c).
 *
 * Чистая логика без Prisma: на вход — этапы шаблона и выигранные версии
 * расчётов этого шаблона с фактом из журнала (`Stage.actualHours` — агрегат
 * `ActualEntry`), на выход — черновики предложений с объяснением.
 *
 * Правила (подробно — `docs/norm-proposals.md`):
 * - наблюдение — этап выигранной версии, совпадающий с этапом шаблона по
 *   имени и роли; этапы согласования не участвуют;
 * - в выборку попадают только завершённые этапы: факт проекта закрыт
 *   (`Project.actualsClosedAt`) или у этапа есть дата окончания факта;
 * - полное наблюдение — у этапа внесены часы факта. Нет факта ≠ 0 часов:
 *   такие этапы не входят в статистику, а снижают полноту;
 * - статистика — медиана коэффициента «факт / формула текущего норматива»
 *   после отсечения выбросов по Тьюки (1.5·IQR, от 4 наблюдений);
 * - предложение = текущий норматив × медиана (baseHours и hoursPerUnit);
 * - достоверность ограничена сверху: малая или неполная выборка — только
 *   «низкая», «высокая» — только при достаточном числе полных наблюдений.
 */
import { createHash } from 'node:crypto';
import { MIN_NEIGHBOURS } from './calibration';
import { median, round1, round2 } from './stats';

export type NormConfidence = 'low' | 'medium' | 'high';
export type NormProposalStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';

/** Меньше стольких полных наблюдений — достоверность только низкая. */
export const MIN_SAMPLES = MIN_NEIGHBOURS;
/** Полнота ниже порога — достоверность только низкая. */
export const MIN_COMPLETENESS = 0.7;
/** Высокая достоверность: не меньше стольких полных наблюдений… */
export const HIGH_MIN_SAMPLES = 8;
/** …полнота не ниже… */
export const HIGH_MIN_COMPLETENESS = 0.9;
/** …и относительный межквартильный размах коэффициентов не больше. */
export const HIGH_MAX_SPREAD = 0.5;
/** Отсечение выбросов включается с этого числа полных наблюдений. */
export const OUTLIER_MIN_SAMPLES = 4;
export const TUKEY_K = 1.5;
/** Изменение меньше этой доли нормативом не предлагается. */
export const MIN_CHANGE = 0.05;

export interface NormStageTemplate {
  id: string;
  name: string;
  role: string;
  baseHours: number;
  hoursPerUnit: number;
  driverFieldKey: string | null;
}

export interface NormStageRow {
  id: string;
  name: string;
  role: string;
  /** Плановые часы этапа в расчёте (могли быть исправлены архитектором). */
  hours: number;
  isApprovalTask: boolean;
  actualHours: number | null;
  actualEndDate: Date | null;
}

/** Выигранная версия расчёта шаблона. */
export interface NormCalcRow {
  id: string;
  name: string;
  version: number;
  answers: Record<string, unknown>;
  /** Факт проекта закрыт: все этапы считаются завершёнными. */
  actualsClosed: boolean;
  stages: NormStageRow[];
}

/**
 * `no-driver` — у шаблона есть драйвер, а в ответах расчёта его нет: формулу
 * посчитать нельзя, и пустой ответ не считается нулём. Как и `no-actuals`,
 * такое наблюдение неполное и снижает полноту.
 */
export type NormSampleStatus = 'used' | 'outlier' | 'no-actuals' | 'no-driver' | 'zero-formula';

const INCOMPLETE: ReadonlySet<NormSampleStatus> = new Set(['no-actuals', 'no-driver']);

export interface NormSample {
  calculationId: string;
  calculationName: string;
  version: number;
  stageIds: string[];
  driverValue: number | null;
  /** Часы по текущему нормативу для ответов расчёта. */
  formulaHours: number;
  planHours: number;
  actualHours: number | null;
  /** Факт / формула; null — факта нет или формула дала 0. */
  ratio: number | null;
  status: NormSampleStatus;
}

export interface NormExplanation {
  method: 'median-ratio-tukey';
  /** Медиана «факт / формула» по использованным наблюдениям. */
  ratio: number;
  /** (Q3 − Q1) / медиана по использованным наблюдениям; null — меньше двух. */
  spread: number | null;
  fences: { low: number; high: number } | null;
  /** Завершённых этапов в выборке (с фактом и без). */
  considered: number;
  /** Из них с внесённым фактом. */
  complete: number;
  /** Этапы выигранных версий, которые ещё не завершены (в выборку не входят). */
  inProgress: number;
  outliers: number;
  totals: { planHours: number; actualHours: number; formulaHours: number };
  thresholds: {
    minSamples: number;
    minCompleteness: number;
    highMinSamples: number;
    highMinCompleteness: number;
    highMaxSpread: number;
    minChange: number;
  };
  confidenceReasons: string[];
  samples: NormSample[];
}

export interface NormProposalDraft {
  stageTemplateId: string;
  stageName: string;
  /** Снимок этапа шаблона: имя, роль и драйвер тоже определяют формулу и выборку. */
  currentStageName: string;
  currentStageRole: string;
  currentDriverFieldKey: string | null;
  currentBaseHours: number;
  currentHoursPerUnit: number;
  proposedBaseHours: number;
  proposedHoursPerUnit: number;
  sampleSize: number;
  completeness: number;
  confidence: NormConfidence;
  explanation: NormExplanation;
  fingerprint: string;
}

export type NormSkipReason =
  | 'ambiguous-template'
  | 'negative-norm'
  | 'no-samples'
  | 'no-complete-samples'
  | 'zero-formula'
  | 'within-tolerance'
  /** Те же данные уже давали предложение, и владелец его отклонил (ставится в normProposalsData). */
  | 'rejected-same-data';

export interface NormSkip {
  stageTemplateId: string;
  stageName: string;
  reason: NormSkipReason;
  /** Сопутствующие числа: полнота, медиана, сколько наблюдений. */
  detail?: Record<string, number | null>;
}

export interface NormGenerationResult {
  drafts: NormProposalDraft[];
  skipped: NormSkip[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const keyOf = (name: string, role: string) => `${norm(name)}\u0000${role}`;

/** Квартиль с линейной интерполяцией (метод R-7). */
export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Границы Тьюки; null — наблюдений слишком мало, отсечения нет. */
export function tukeyFences(values: number[]): { low: number; high: number } | null {
  if (values.length < OUTLIER_MIN_SAMPLES) return null;
  const q1 = quantile(values, 0.25) as number;
  const q3 = quantile(values, 0.75) as number;
  const iqr = q3 - q1;
  return { low: q1 - TUKEY_K * iqr, high: q3 + TUKEY_K * iqr };
}

/**
 * Уровень достоверности. Порядок проверок важен: ограничения сверху
 * (малая или неполная выборка) применяются раньше «высокой».
 */
export function confidenceFor(
  sampleSize: number,
  completeness: number,
  spread: number | null,
): { level: NormConfidence; reasons: string[] } {
  const reasons: string[] = [];
  if (sampleSize < MIN_SAMPLES) {
    reasons.push(`Полных наблюдений ${sampleSize} — меньше ${MIN_SAMPLES}: только низкая.`);
  }
  if (completeness < MIN_COMPLETENESS) {
    reasons.push(
      `Факт внесён по ${Math.round(completeness * 100)}% завершённых этапов — меньше ${Math.round(MIN_COMPLETENESS * 100)}%: только низкая.`,
    );
  }
  if (reasons.length > 0) return { level: 'low', reasons };

  if (sampleSize < HIGH_MIN_SAMPLES) {
    reasons.push(`Для высокой нужно не меньше ${HIGH_MIN_SAMPLES} полных наблюдений.`);
  }
  if (completeness < HIGH_MIN_COMPLETENESS) {
    reasons.push(`Для высокой нужна полнота не ниже ${Math.round(HIGH_MIN_COMPLETENESS * 100)}%.`);
  }
  if (spread === null || spread > HIGH_MAX_SPREAD) {
    reasons.push(
      `Разброс коэффициентов ${spread === null ? 'не определён' : `${Math.round(spread * 100)}%`} — для высокой не больше ${Math.round(HIGH_MAX_SPREAD * 100)}%.`,
    );
  }
  if (reasons.length > 0) return { level: 'medium', reasons };
  return {
    level: 'high',
    reasons: [`${sampleSize} полных наблюдений, полнота ${Math.round(completeness * 100)}%.`],
  };
}

/**
 * Значение драйвера: null — у этапа нет драйвера; undefined — драйвер есть,
 * а ответа нет или он не число (наблюдение неполное, не ноль).
 */
function driverOf(
  st: NormStageTemplate,
  answers: Record<string, unknown>,
): number | null | undefined {
  if (!st.driverFieldKey) return null;
  const raw = answers[st.driverFieldKey];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function fingerprintOf(draft: Omit<NormProposalDraft, 'fingerprint'>): string {
  const payload = {
    st: draft.stageTemplateId,
    stage: [draft.currentStageName, draft.currentStageRole, draft.currentDriverFieldKey],
    cur: [draft.currentBaseHours, draft.currentHoursPerUnit],
    prop: [draft.proposedBaseHours, draft.proposedHoursPerUnit],
    conf: draft.confidence,
    samples: draft.explanation.samples
      .map((s) => [s.calculationId, s.status, s.actualHours, s.formulaHours])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/** Предложения по всем этапам шаблона. */
export function buildNormProposals(
  stageTemplates: NormStageTemplate[],
  calcs: NormCalcRow[],
): NormGenerationResult {
  const drafts: NormProposalDraft[] = [];
  const skipped: NormSkip[] = [];

  const keyCount = new Map<string, number>();
  for (const st of stageTemplates) {
    const k = keyOf(st.name, st.role);
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }

  for (const st of stageTemplates) {
    const skip = (reason: NormSkipReason, detail?: NormSkip['detail']) =>
      skipped.push({ stageTemplateId: st.id, stageName: st.name, reason, detail });
    const key = keyOf(st.name, st.role);
    // Два этапа шаблона с одинаковыми именем и ролью неразличимы в расчётах.
    if ((keyCount.get(key) ?? 0) > 1) {
      skip('ambiguous-template');
      continue;
    }
    // Отрицательный норматив (заведён до проверки знака) масштабировать нельзя:
    // предложение тоже было бы отрицательным. Пропускаем этап, а не весь прогон.
    if (
      !(Number.isFinite(st.baseHours) && st.baseHours >= 0) ||
      !(Number.isFinite(st.hoursPerUnit) && st.hoursPerUnit >= 0)
    ) {
      skip('negative-norm', { baseHours: st.baseHours, hoursPerUnit: st.hoursPerUnit });
      continue;
    }

    const samples: NormSample[] = [];
    let inProgress = 0;
    for (const calc of calcs) {
      const stages = calc.stages.filter((s) => !s.isApprovalTask && keyOf(s.name, s.role) === key);
      if (stages.length === 0) continue;
      const finished = calc.actualsClosed || stages.every((s) => s.actualEndDate !== null);
      if (!finished) {
        inProgress += 1;
        continue;
      }
      const driverValue = driverOf(st, calc.answers);
      const formulaHours =
        driverValue === undefined
          ? 0
          : Math.max(0, st.baseHours + st.hoursPerUnit * (driverValue ?? 0));
      const hasActuals = stages.every((s) => s.actualHours !== null && s.actualHours !== undefined);
      const actualHours = hasActuals
        ? round2(stages.reduce((s, x) => s + (x.actualHours as number), 0))
        : null;
      const status: NormSampleStatus = !hasActuals
        ? 'no-actuals'
        : driverValue === undefined
          ? 'no-driver'
          : formulaHours <= 0
            ? 'zero-formula'
            : 'used';
      samples.push({
        calculationId: calc.id,
        calculationName: calc.name,
        version: calc.version,
        stageIds: stages.map((s) => s.id),
        driverValue: driverValue ?? null,
        formulaHours: round2(formulaHours),
        planHours: round2(stages.reduce((s, x) => s + x.hours, 0)),
        actualHours,
        ratio: status === 'used' ? (actualHours as number) / formulaHours : null,
        status,
      });
    }

    const considered = samples.length;
    if (considered === 0) {
      skip('no-samples', { inProgress });
      continue;
    }
    const complete = samples.filter((s) => !INCOMPLETE.has(s.status)).length;
    // С порогами сравнивается точная доля; округлённая — только для хранения и
    // показа (иначе 16/23 ≈ 0.696 округлилась бы до 0.7 и прошла порог).
    const rawCompleteness = complete / considered;
    const completeness = round2(rawCompleteness);

    const fences = tukeyFences(
      samples.filter((s) => s.status === 'used').map((s) => s.ratio as number),
    );
    if (fences) {
      for (const s of samples) {
        if (s.status === 'used' && (s.ratio! < fences.low || s.ratio! > fences.high)) {
          s.status = 'outlier';
        }
      }
    }
    const used = samples.filter((s) => s.status === 'used');
    const ratios = used.map((s) => s.ratio as number);
    const ratio = median(ratios);
    if (ratio === null) {
      // Полные наблюдения есть, но у всех формула дала 0 ч — коэффициент не определён.
      skip(complete > 0 ? 'zero-formula' : 'no-complete-samples', {
        considered,
        complete,
        completeness,
      });
      continue;
    }
    if (Math.abs(ratio - 1) < MIN_CHANGE) {
      skip('within-tolerance', { ratio: round2(ratio), sampleSize: used.length, completeness });
      continue;
    }

    const proposedBaseHours = round1(st.baseHours * ratio);
    const proposedHoursPerUnit = round2(st.hoursPerUnit * ratio);
    if (proposedBaseHours === st.baseHours && proposedHoursPerUnit === st.hoursPerUnit) {
      skip('within-tolerance', { ratio: round2(ratio), sampleSize: used.length, completeness });
      continue;
    }

    const q1 = quantile(ratios, 0.25);
    const q3 = quantile(ratios, 0.75);
    const rawSpread =
      ratios.length >= 2 && ratio > 0 && q1 !== null && q3 !== null ? (q3 - q1) / ratio : null;
    const spread = rawSpread === null ? null : round2(rawSpread);
    const conf = confidenceFor(used.length, rawCompleteness, rawSpread);

    const sum = (f: (s: NormSample) => number) => round1(used.reduce((a, s) => a + f(s), 0));
    const explanation: NormExplanation = {
      method: 'median-ratio-tukey',
      ratio: round2(ratio),
      spread,
      fences: fences ? { low: round2(fences.low), high: round2(fences.high) } : null,
      considered,
      complete,
      inProgress,
      outliers: samples.filter((s) => s.status === 'outlier').length,
      totals: {
        planHours: sum((s) => s.planHours),
        actualHours: sum((s) => s.actualHours as number),
        formulaHours: sum((s) => s.formulaHours),
      },
      thresholds: {
        minSamples: MIN_SAMPLES,
        minCompleteness: MIN_COMPLETENESS,
        highMinSamples: HIGH_MIN_SAMPLES,
        highMinCompleteness: HIGH_MIN_COMPLETENESS,
        highMaxSpread: HIGH_MAX_SPREAD,
        minChange: MIN_CHANGE,
      },
      confidenceReasons: conf.reasons,
      samples: samples.map((s) => ({ ...s, ratio: s.ratio === null ? null : round2(s.ratio) })),
    };
    const draft = {
      stageTemplateId: st.id,
      stageName: st.name,
      currentStageName: st.name,
      currentStageRole: st.role,
      currentDriverFieldKey: st.driverFieldKey,
      currentBaseHours: st.baseHours,
      currentHoursPerUnit: st.hoursPerUnit,
      proposedBaseHours,
      proposedHoursPerUnit,
      sampleSize: used.length,
      completeness,
      confidence: conf.level,
      explanation,
    };
    drafts.push({ ...draft, fingerprint: fingerprintOf(draft) });
  }

  return { drafts, skipped };
}

export interface NormSnapshot {
  currentStageName: string;
  currentStageRole: string;
  currentDriverFieldKey: string | null;
  currentBaseHours: number;
  currentHoursPerUnit: number;
}

/**
 * Этап шаблона не менялся с момента формирования предложения: норматив,
 * драйвер, имя и роль (по имени и роли собиралась выборка). Сравнение точное —
 * так же сравнивает условный UPDATE в `decideNormProposal`.
 */
export function snapshotMatches(
  proposal: NormSnapshot,
  stageTemplate: {
    name: string;
    role: string;
    driverFieldKey: string | null;
    baseHours: number;
    hoursPerUnit: number;
  },
): boolean {
  return (
    proposal.currentBaseHours === stageTemplate.baseHours &&
    proposal.currentHoursPerUnit === stageTemplate.hoursPerUnit &&
    proposal.currentDriverFieldKey === stageTemplate.driverFieldKey &&
    proposal.currentStageName === stageTemplate.name &&
    proposal.currentStageRole === stageTemplate.role
  );
}
