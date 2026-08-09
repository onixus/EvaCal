import type { ProjectContext } from '../context/types';
import type { Gost34EnrichmentOptions } from '../types';
import { ApplicabilityResult, ApplicabilityStatus, ApplicabilityOverride } from './types';
import { APPLICABILITY_RULES } from './rules';

export type OverrideInput =
  | Record<string, ApplicabilityOverride | ApplicabilityStatus | boolean | undefined>
  | Gost34EnrichmentOptions;

/**
 * Нормализует переданный override к стандартному формату ApplicabilityOverride.
 */
function normalizeOverride(
  override?: ApplicabilityOverride | ApplicabilityStatus | boolean,
): ApplicabilityOverride | undefined {
  if (override === undefined || override === null) return undefined;
  if (typeof override === 'boolean') {
    return {
      status: override ? 'APPLICABLE' : 'NOT_APPLICABLE',
      confirmedBy: 'Ручной выбор',
      reason: override ? 'Включено пользователем' : 'Отключено пользователем',
    };
  }
  if (typeof override === 'string') {
    if (override === 'APPLICABLE' || override === 'NOT_APPLICABLE') {
      return {
        status: override,
        confirmedBy: 'Ручной выбор',
        reason:
          override === 'APPLICABLE' ? 'Подтверждено пользователем' : 'Отклонено пользователем',
      };
    }
    return undefined;
  }
  return override;
}

/**
 * Оценивает применимость всех нормативных актов и стандартов на основе ProjectContext
 * с возможностью наложения ручных решений (overrides).
 */
export function evaluateApplicability(
  context: ProjectContext = {},
  overrides?: OverrideInput,
): ApplicabilityResult[] {
  return APPLICABILITY_RULES.map((rule) => {
    const evaluation = rule.evaluate(context);
    const normalizedOverride = normalizeOverride((overrides as Record<string, any>)?.[rule.id]);

    const finalStatus: ApplicabilityStatus = normalizedOverride
      ? normalizedOverride.status
      : evaluation.status;

    const reasons = [...evaluation.reasons];
    if (normalizedOverride) {
      reasons.push(
        `Ручное решение: ${normalizedOverride.status === 'APPLICABLE' ? 'Применимо' : 'Не применимо'}${
          normalizedOverride.confirmedBy ? ` (${normalizedOverride.confirmedBy})` : ''
        }${normalizedOverride.reason ? `: ${normalizedOverride.reason}` : ''}`,
      );
    }

    return {
      standardId: rule.id,
      title: rule.title,
      category: rule.category,
      calculatedStatus: evaluation.status,
      finalStatus,
      reasons,
      evidence: evaluation.evidence,
      confidence: evaluation.confidence,
      confirmedStatus: normalizedOverride?.status,
      confirmedBy: normalizedOverride?.confirmedBy,
      overrideReason: normalizedOverride?.reason,
    };
  });
}

/**
 * Оценивает применимость конкретного стандарта по ID.
 */
export function evaluateStandardApplicability(
  standardId: string,
  context: ProjectContext = {},
  override?: ApplicabilityOverride | ApplicabilityStatus | boolean,
): ApplicabilityResult | undefined {
  const rule = APPLICABILITY_RULES.find((r) => r.id === standardId);
  if (!rule) return undefined;

  const evaluation = rule.evaluate(context);
  const normalizedOverride = normalizeOverride(override);
  const finalStatus: ApplicabilityStatus = normalizedOverride
    ? normalizedOverride.status
    : evaluation.status;

  const reasons = [...evaluation.reasons];
  if (normalizedOverride) {
    reasons.push(
      `Ручное решение: ${normalizedOverride.status === 'APPLICABLE' ? 'Применимо' : 'Не применимо'}${
        normalizedOverride.confirmedBy ? ` (${normalizedOverride.confirmedBy})` : ''
      }${normalizedOverride.reason ? `: ${normalizedOverride.reason}` : ''}`,
    );
  }

  return {
    standardId: rule.id,
    title: rule.title,
    category: rule.category,
    calculatedStatus: evaluation.status,
    finalStatus,
    reasons,
    evidence: evaluation.evidence,
    confidence: evaluation.confidence,
    confirmedStatus: normalizedOverride?.status,
    confirmedBy: normalizedOverride?.confirmedBy,
    overrideReason: normalizedOverride?.reason,
  };
}

/**
 * Преобразует результаты оценки применимости в набор флагов Gost34EnrichmentOptions.
 * Флаг true ставится ТОЛЬКО для стандартов с finalStatus === 'APPLICABLE'.
 */
export function toEnrichmentOptions(results: ApplicabilityResult[]): Gost34EnrichmentOptions {
  const options: Record<string, boolean> = {};
  for (const item of results) {
    options[item.standardId] = item.finalStatus === 'APPLICABLE';
  }
  return options as Gost34EnrichmentOptions;
}

/** Возвращает только подтверждённые применимые стандарты. */
export function getApplicableStandards(results: ApplicabilityResult[]): ApplicabilityResult[] {
  return results.filter((r) => r.finalStatus === 'APPLICABLE');
}

/** Возвращает стандарты, требующие подтверждения у Заказчика (UNKNOWN). */
export function getUnknownStandards(results: ApplicabilityResult[]): ApplicabilityResult[] {
  return results.filter((r) => r.finalStatus === 'UNKNOWN');
}

/** Возвращает стандарты, признанные неприменимыми (NOT_APPLICABLE). */
export function getNotApplicableStandards(results: ApplicabilityResult[]): ApplicabilityResult[] {
  return results.filter((r) => r.finalStatus === 'NOT_APPLICABLE');
}

/** Сводная статистика применимости для UI и валидации. */
export function getApplicabilitySummary(results: ApplicabilityResult[]) {
  const applicable = results.filter((r) => r.finalStatus === 'APPLICABLE').length;
  const unknown = results.filter((r) => r.finalStatus === 'UNKNOWN').length;
  const notApplicable = results.filter((r) => r.finalStatus === 'NOT_APPLICABLE').length;
  const confidenceSum = results.reduce((sum, r) => sum + (r.confidence ?? 0), 0);
  const confidenceAverage = results.length > 0 ? confidenceSum / results.length : 0;

  return {
    total: results.length,
    applicable,
    unknown,
    notApplicable,
    confidenceAverage: Math.round(confidenceAverage * 100) / 100,
  };
}
