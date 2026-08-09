import { finding, RequirementCheck } from "../context";
import type { ValidationFinding } from "../types";

/**
 * Однозначность. Оценочные формулировки («быстро», «удобно») означают, что
 * приёмка требования зависит от мнения проверяющего.
 */
export function checkAmbiguity(check: RequirementCheck): ValidationFinding[] {
  if (!check.vagueTerms.length) return [];

  const terms = check.vagueTerms.map((term) => `«${term}»`).join(", ");

  return [
    finding(
      check,
      "ambiguity",
      "WARNING",
      `Требование содержит оценочные формулировки: ${terms}.`,
      "Заменить оценочную формулировку измеримым показателем с единицей измерения.",
    ),
  ];
}
