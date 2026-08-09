import type { RequirementCategory } from "../../types";
import { CONFLICT_INDICATORS } from "../lexicon";
import { finding, RequirementCheck } from "../context";
import type { ValidationFinding } from "../types";

/** Категории, которые по существу задают количественный показатель. */
const QUANTIFIABLE_CATEGORIES: RequirementCategory[] = [
  "performance",
  "reliability",
];

function needsNumericValue(check: RequirementCheck): boolean {
  if (QUANTIFIABLE_CATEGORIES.includes(check.requirement.category)) return true;
  if (check.requirement.type === "nonfunctional") return true;

  // Требование называет показатель (RTO, срок хранения, доступность) — значит, у него есть значение.
  return CONFLICT_INDICATORS.some((indicator) =>
    indicator.pattern.test(check.text),
  );
}

/**
 * Измеримость. Показатель без числового значения нельзя ни спроектировать,
 * ни проверить на приёмочных испытаниях.
 */
export function checkMeasurability(
  check: RequirementCheck,
): ValidationFinding[] {
  if (!check.text || check.measurable || !needsNumericValue(check)) return [];

  return [
    finding(
      check,
      "measurability",
      "ERROR",
      "Не определён измеримый показатель: в требовании нет числового значения с единицей измерения.",
      "Указать значение и границу, например «время отклика — не более 2 с при 100 одновременных пользователях».",
    ),
  ];
}
