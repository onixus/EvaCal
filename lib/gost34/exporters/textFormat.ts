/**
 * Текстовые правила оформления документа по замечаниям нормоконтроля.
 *
 * Собраны отдельно от сборщика Word: правила применяются ко всему видимому
 * тексту (титул, заголовки, абзацы, таблицы), а не к отдельным местам.
 */

const NBSP = '\u00A0';
const EN_DASH = '\u2013';

/** Аббревиатуры, которые остаются прописными при переводе заголовка в строчные. */
const KEEP_UPPERCASE = new Set([
  'АС',
  'АРМ',
  'АСУ',
  'БД',
  'ГОСТ',
  'ЕСКД',
  'ИБ',
  'КИИ',
  'НСД',
  'ОС',
  'ПЗ',
  'ПМИ',
  'ПСИ',
  'РД',
  'СУБД',
  'ТЗ',
  'ФЗ',
  'ФСТЭК',
  'ЭП',
  'IT',
  'API',
  'RPO',
  'RTO',
]);

/**
 * Буква «ё» не применяется в технической документации (замечание нормоконтроля),
 * а обозначения стандартов не должны разрываться переносом строки.
 */
export function sanitizeDocText(text: string): string {
  return (
    text
      .replace(/ё/g, 'е')
      .replace(/Ё/g, 'Е')
      // `\b` не работает с кириллицей: границу слова задаём явным классом
      .replace(/(^|[^A-Za-zА-Яа-я])(ГОСТ|РД|СП|СТО|ISO|IEC)\s+Р\s+/g, `$1$2${NBSP}Р${NBSP}`)
      .replace(/(^|[^A-Za-zА-Яа-я])(ГОСТ|РД|СП|СТО|ISO|IEC)\s+(?=[\dР])/g, `$1$2${NBSP}`)
      .replace(/№\s+/g, `№${NBSP}`)
      .replace(/(^|[\s(])п\.\s+/g, `$1п.${NBSP}`)
  );
}

/**
 * Заголовки хранятся прописными, а печатаются строчными с прописной буквы:
 * «ОБЩИЕ СВЕДЕНИЯ» → «Общие сведения». Аббревиатуры сохраняются.
 */
export function toHeadingCase(title: string): string {
  const hasLowercase = /[a-zа-яё]/.test(title);
  if (hasLowercase) return title;

  const lowered = title.replace(/[A-ZА-ЯЁ]+/g, (word, offset: number, source: string) => {
    if (KEEP_UPPERCASE.has(word)) return word;
    // «ПО» — аббревиатура только вне позиции предлога: «оборудования и ПО»,
    // но «работ по созданию АС».
    if (word === 'ПО' && !/^\s+[A-ZА-ЯЁ]/.test(source.slice(offset + word.length))) return word;
    return word.toLowerCase();
  });

  return lowered.replace(/[a-zа-я]/, (first) => first.toUpperCase());
}

/**
 * Наименование таблицы по ГОСТ 2.105: слово «Таблица» вразрядку, номер,
 * тире, наименование. Полужирным не выделяется (оформляется вызывающим кодом).
 */
export function formatTableCaption(number: string, caption?: string): string {
  const label = `Т а б л и ц а${NBSP}${number}`;
  const name = stripTableCaptionPrefix(caption || '').trim();
  return name ? `${label} ${EN_DASH} ${name}` : label;
}

/** Убирает ручной префикс «Таблица N —», если он остался в исходных данных. */
export function stripTableCaptionPrefix(caption: string): string {
  return caption.replace(/^\s*Т\s*а?\s*б\s*л\s*и?\s*ц\s*а\s*[\wА-Яа-я.]*\s*[—–-]?\s*/, '');
}

/** Пункт вида «1.3 ...»: номер отделяется для оформления по образцу подразделов. */
export function splitNumberedClause(text: string): { number: string; rest: string } | null {
  const match = /^(\d+(?:\.\d+)+)\s+([\s\S]*)$/.exec(text);
  return match ? { number: match[1], rest: match[2] } : null;
}
