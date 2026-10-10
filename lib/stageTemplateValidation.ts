/**
 * Проверка норматива этапа шаблона при сохранении: базовые часы и часы на
 * единицу — неотрицательные конечные числа. Отрицательный норматив давал бы
 * отрицательные предложения по факту (#103 WP-6c) и бессмысленные формулы.
 * Возвращает текст ошибки или null; отсутствующие поля не проверяются.
 */
export function invalidNormHours(body: {
  baseHours?: unknown;
  hoursPerUnit?: unknown;
}): string | null {
  for (const [key, label] of [
    ['baseHours', 'Базовые часы'],
    ['hoursPerUnit', 'Часы на единицу'],
  ] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `${label}: неотрицательное число`;
    }
  }
  return null;
}
