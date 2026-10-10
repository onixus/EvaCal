/**
 * Единые правила разбора ответов опросника. Ими пользуются и пресейл-sizing,
 * и проектный контекст ГОСТ 34: иначе один и тот же ответ («10 Гбит/с»)
 * в одном месте считался числом, а в другом — незаданным значением.
 *
 * undefined означает «ответа нет»; явные 0 и false — законные значения.
 */

const TRUE_WORDS = /^(да|yes|true|1|есть|требуется)$/i;
const FALSE_WORDS = /^(нет|no|false|0|не требуется|отсутствует)$/i;

/** Число из ответа; из строки берётся первое число («10 Гбит/с» → 10, «2,5» → 2.5). */
export function parseAnswerNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const match = value.replace(',', '.').match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

/** Логическое значение из ответа; нераспознанный текст — undefined. */
export function parseAnswerBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim();
    if (TRUE_WORDS.test(v)) return true;
    if (FALSE_WORDS.test(v)) return false;
  }
  return undefined;
}
