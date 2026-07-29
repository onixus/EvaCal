// Every calculation automatically gets a project-manager (РП) allowance:
// 16h split across kickoff + closeout, plus a complexity-based overhead
// on top of everyone else's labor hours.

export const COMPLEXITY_LEVELS = [
  { value: "Простой", percent: 10 },
  { value: "Средний", percent: 20 },
  { value: "Сложный", percent: 30 },
] as const;

export const COMPLEXITY_OPTIONS = COMPLEXITY_LEVELS.map((l) => l.value);
export const DEFAULT_COMPLEXITY_PERCENT = 20; // used when no complexity field/value is set

export const PM_START_HOURS = 8;
export const PM_CLOSE_HOURS = 8;

export function complexityPercent(value: string | undefined | null): number {
  const found = COMPLEXITY_LEVELS.find((l) => l.value === value);
  return found ? found.percent : DEFAULT_COMPLEXITY_PERCENT;
}

/**
 * РП isn't a Gantt stage — it's a scalar allowance counted only in the calculation's
 * total labor hours. otherStagesHours = sum of hours of every non-approval stage.
 */
export function computePmHours(
  fields: { key: string; type: string }[],
  answers: Record<string, unknown>,
  otherStagesHours: number
): number {
  const complexityField = fields.find((f) => f.type === "complexity");
  const complexityValue = complexityField ? String(answers[complexityField.key] ?? "") : "";
  const percent = complexityPercent(complexityValue);
  const overhead = (percent / 100) * otherStagesHours;
  return Math.round((PM_START_HOURS + PM_CLOSE_HOURS + overhead + Number.EPSILON) * 100) / 100;
}
