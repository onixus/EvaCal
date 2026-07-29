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

export interface PmStages {
  start: { name: string; role: "pm"; hours: number };
  close: { name: string; role: "pm"; hours: number };
}

/** otherStagesHours = sum of hours of every non-PM, non-approval stage in the calculation. */
export function buildPmStages(
  fields: { key: string; type: string }[],
  answers: Record<string, unknown>,
  otherStagesHours: number
): PmStages {
  const complexityField = fields.find((f) => f.type === "complexity");
  const complexityValue = complexityField ? String(answers[complexityField.key] ?? "") : "";
  const percent = complexityPercent(complexityValue);
  const overhead = Math.round(((percent / 100) * otherStagesHours + Number.EPSILON) * 100) / 100;

  return {
    start: { name: "РП: старт проекта", role: "pm", hours: PM_START_HOURS },
    close: { name: "РП: закрытие проекта", role: "pm", hours: PM_CLOSE_HOURS + overhead },
  };
}
