import { GroundingPack } from './grounding';
import { LlmDraftFlag, LlmDraftFlagCode, LlmDraftFlagSeverity } from './types';
import { stripClausePrefix } from '../../index';
import { CITATION_CATALOG, CITATION_SHAPE } from './citationCatalog';
import {
  UPPER_BOUND_PATTERN,
  LOWER_BOUND_PATTERN,
  MODAL_PATTERN,
  NEGATION_PATTERN,
  parseNumber,
} from '../../validation/lexicon';

export type Bound = 'upper' | 'lower' | 'eq';

export interface NumberAtom {
  value: number;
  unit: string | null;
  span: string;
}

export interface ConstraintAtom extends NumberAtom {
  bound: Bound;
  sourceSpan: string;
}

export interface CitationAtom {
  id: string | null;
  span: string;
}

export interface ModalityBag {
  must: number;
  mustNot: number;
  may: number;
}

export const CANON_UNIT: Record<string, string> = {
  '%': 'pct',
  проц: 'pct',
  процента: 'pct',
  процентов: 'pct',
  мс: 'ms',
  'с.': 's',
  с: 's',
  сек: 's',
  секунда: 's',
  секунды: 's',
  секунд: 's',
  мин: 'min',
  минута: 'min',
  минуты: 'min',
  минут: 'min',
  час: 'h',
  часа: 'h',
  часов: 'h',
  'ч.': 'h',
  ч: 'h',
  сут: 'day',
  суток: 'day',
  дня: 'day',
  дней: 'day',
  дн: 'day',
  неделя: 'week',
  недели: 'week',
  недель: 'week',
  месяц: 'month',
  месяца: 'month',
  месяцев: 'month',
  год: 'year',
  года: 'year',
  лет: 'year',
  кб: 'kb',
  кбайт: 'kb',
  мб: 'mb',
  мбайт: 'mb',
  гб: 'gb',
  гбайт: 'gb',
  тб: 'tb',
  тбайт: 'tb',
  кбит: 'kbit',
  мбит: 'mbit',
  гбит: 'gbit',
  пользователь: 'users',
  пользователя: 'users',
  пользователей: 'users',
  запрос: 'req',
  запроса: 'req',
  запросов: 'req',
  транзакц: 'txn',
  операц: 'ops',
  сеанс: 'sessions',
  сеанса: 'sessions',
  сеансов: 'sessions',
  документ: 'docs',
  документа: 'docs',
  документов: 'docs',
  шт: 'pcs',
  rps: 'rps',
  tps: 'tps',
  sla: 'pct',
};

export function canonUnit(raw?: string): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/ё/g, 'е').replace(/\.$/, '');
  if (CANON_UNIT[key]) return CANON_UNIT[key];
  const prefix = Object.keys(CANON_UNIT).find((k) => k.length >= 4 && key.startsWith(k));
  return prefix ? CANON_UNIT[prefix] : null;
}

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCitationText(text: string): string {
  return normalizeText(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(?:^|[^0-9a-zа-яё])россии(?:$|[^0-9a-zа-яё])/giu, ' ')
    .replace(/(?:№|no)\s*/gi, '№')
    .replace(/\s+/g, ' ')
    .trim();
}

const MEASURE_REGEX =
  /(?<=^|[^0-9a-zа-яё])(\d+(?:[.,]\d+)?)\s*(%|проц[а-яё]*|мс|с\.|с|сек[а-яё]*|мин[а-яё]*|час[а-яё]*|ч\.|сут[а-яё]*|дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*|год[а-яё]*|лет|кб[а-яё]*|мб[а-яё]*|гб[а-яё]*|тб[а-яё]*|кбит[а-яё]*|мбит[а-яё]*|гбит[а-яё]*|пользовател[а-яё]*|запрос[а-яё]*|транзакц[а-яё]*|операц[а-яё]*|сеанс[а-яё]*|документ[а-яё]*|шт|rps|tps)(?=$|[^0-9a-zа-яё])/giu;

export function extractConstraints(text: string): ConstraintAtom[] {
  const clean = text.split('\n').map(stripClausePrefix).join(' ');
  const results: ConstraintAtom[] = [];

  // Upper bound
  const upperRegex = new RegExp(UPPER_BOUND_PATTERN.source, 'giu');
  let m: RegExpExecArray | null;
  while ((m = upperRegex.exec(clean)) !== null) {
    const rawVal = m[1];
    const rawUnit = m[2];
    const val = parseNumber(rawVal);
    const unit = canonUnit(rawUnit);
    results.push({
      bound: 'upper',
      value: val,
      unit,
      span: m[0].trim(),
      sourceSpan: m[0].trim(),
    });
  }

  // Lower bound
  const lowerRegex = new RegExp(LOWER_BOUND_PATTERN.source, 'giu');
  while ((m = lowerRegex.exec(clean)) !== null) {
    const rawVal = m[1];
    const rawUnit = m[2];
    const val = parseNumber(rawVal);
    const unit = canonUnit(rawUnit);
    results.push({
      bound: 'lower',
      value: val,
      unit,
      span: m[0].trim(),
      sourceSpan: m[0].trim(),
    });
  }

  // Pure measures without explicit bound
  const measureRegex = new RegExp(MEASURE_REGEX.source, 'giu');
  while ((m = measureRegex.exec(clean)) !== null) {
    const span = m[0].trim();
    // Check if this match is already covered by an upper/lower bound
    const isCovered = results.some((r) => r.sourceSpan.includes(span));
    if (!isCovered) {
      const val = parseNumber(m[1]);
      const unit = canonUnit(m[2]);
      results.push({
        bound: 'eq',
        value: val,
        unit,
        span,
        sourceSpan: span,
      });
    }
  }

  return results;
}

export function extractCitations(text: string): CitationAtom[] {
  const norm = normalizeCitationText(text);
  const results: CitationAtom[] = [];
  const matchedSpans: Array<{ start: number; end: number }> = [];

  for (const item of CITATION_CATALOG) {
    const reg = new RegExp(item.aliases.source, 'giu');
    let m: RegExpExecArray | null;
    while ((m = reg.exec(norm)) !== null) {
      results.push({
        id: item.id,
        span: m[0].trim(),
      });
      matchedSpans.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  // Remaining citations that match shape but no catalog id
  const shapeReg = new RegExp(CITATION_SHAPE.source, 'giu');
  let sm: RegExpExecArray | null;
  while ((sm = shapeReg.exec(norm)) !== null) {
    const start = sm.index;
    const end = sm.index + sm[0].length;
    const overlaps = matchedSpans.some(
      (span) => Math.max(start, span.start) < Math.min(end, span.end),
    );
    if (!overlaps) {
      const slice = norm.slice(start, start + 40).split(/[.,;!?\n]/)[0];
      results.push({
        id: null,
        span: slice.trim(),
      });
    }
  }

  return results;
}

export function extractMeasuredNumbers(text: string): NumberAtom[] {
  const clean = text.split('\n').map(stripClausePrefix).join(' ');
  const citations = extractCitations(clean);
  const results: NumberAtom[] = [];

  const measureRegex = new RegExp(MEASURE_REGEX.source, 'giu');
  let m: RegExpExecArray | null;
  while ((m = measureRegex.exec(clean)) !== null) {
    const span = m[0].trim();
    // Do not count if fully inside citation span
    const insideCitation = citations.some((c) => c.span.includes(span));
    if (!insideCitation) {
      results.push({
        value: parseNumber(m[1]),
        unit: canonUnit(m[2]),
        span,
      });
    }
  }

  return results;
}

export function extractBareIntegers(text: string, measured: NumberAtom[], citations: CitationAtom[]): NumberAtom[] {
  const clean = text.split('\n').map(stripClausePrefix).join(' ');
  const results: NumberAtom[] = [];

  const intRegex = /(?<=^|[^0-9a-zа-яё.,])(\d{1,3})(?=$|[^0-9a-zа-яё.,])/giu;
  let m: RegExpExecArray | null;
  while ((m = intRegex.exec(clean)) !== null) {
    const val = Number(m[1]);
    const span = m[1];
    const index = m.index;

    // Check if surrounded by ГОСТ or year
    const windowBefore = clean.slice(Math.max(0, index - 15), index).toLowerCase();
    const windowAfter = clean.slice(index + span.length, index + span.length + 15).toLowerCase();
    if (windowBefore.includes('гост') || windowAfter.includes('гост')) {
      continue;
    }
    // Check if part of a measured number
    const isMeasured = measured.some((meas) => meas.span.includes(span));
    if (isMeasured) continue;

    // Check if part of citation
    const isCitation = citations.some((cit) => cit.span.includes(span));
    if (isCitation) continue;

    results.push({
      value: val,
      unit: null,
      span,
    });
  }

  return results;
}

export function extractModality(text: string): ModalityBag {
  const clean = text.toLowerCase();

  // Negations
  const negMatches = clean.match(new RegExp(NEGATION_PATTERN.source, 'giu')) || [];
  const mustNot = negMatches.length;

  // May
  const mayMatches = clean.match(/(?<=^|[^0-9a-zа-яё])(?:может|допускается|рекомендуется|вправе)(?=$|[^0-9a-zа-яё])/giu) || [];
  const may = mayMatches.length;

  // Must
  const modalMatches = clean.match(new RegExp(MODAL_PATTERN.source, 'giu')) || [];
  // Subtract those that were negations
  const must = Math.max(0, modalMatches.length - mustNot);

  return { must, mustNot, may };
}

function allowedNumberBag(pack: GroundingPack, baselineNorm: string): NumberAtom[] {
  const chunks = [
    baselineNorm,
    JSON.stringify(pack.contextSlice),
    ...pack.requirements.flatMap((r) => [r.originalText, r.normalizedText ?? '']),
    pack.allowedCitationTexts.join(' '),
  ];
  if (pack.calculationFacts) {
    chunks.push(JSON.stringify(pack.calculationFacts));
  }
  return chunks.flatMap((c) => {
    const meas = extractMeasuredNumbers(c);
    const cits = extractCitations(c);
    const bare = extractBareIntegers(c, meas, cits);
    return [...meas, ...bare];
  });
}

function numberInBag(atom: NumberAtom, bag: NumberAtom[]): boolean {
  return bag.some(
    (b) => b.value === atom.value && (atom.unit == null || b.unit == null || b.unit === atom.unit),
  );
}

export function detectDraftFlags(
  pack: GroundingPack,
  baselineParagraphs: string[],
  draftParagraphs: string[],
): LlmDraftFlag[] {
  const flags: LlmDraftFlag[] = [];

  const cleanBaseline = (baselineParagraphs || []).map((p: string) => stripClausePrefix(p)).map((p: string) => normalizeText(p)).filter(Boolean);
  const cleanDraft = (draftParagraphs || []).map((p: string) => stripClausePrefix(p)).map((p: string) => normalizeText(p)).filter(Boolean);

  const B = cleanBaseline.join('\n');
  const D = cleanDraft.join('\n');

  // Rule 0. Empty draft
  if (cleanDraft.length === 0) {
    const baselineConstraints = extractConstraints(B);
    if (baselineConstraints.length > 0) {
      for (const c of baselineConstraints) {
        flags.push({
          code: 'LLM_REMOVED_CONSTRAINT',
          severity: 'block',
          span: c.sourceSpan,
          detail: `Обязательное ограничение «${c.sourceSpan}» отсутствует: черновик пуст`,
        });
      }
    } else {
      flags.push({
        code: 'LLM_REMOVED_CONSTRAINT',
        severity: 'block',
        span: B.slice(0, 100) || 'черновик пуст',
        detail: 'Черновик пуст',
      });
    }
    return flags;
  }

  // Rule 1. draft == baseline
  if (B === D) {
    return [];
  }

  const baselineConstraints = extractConstraints(B);
  const draftConstraints = extractConstraints(D);

  // Rule 2. LLM_REMOVED_CONSTRAINT (block)
  for (const bc of baselineConstraints) {
    const match = draftConstraints.some(
      (dc) => dc.bound === bc.bound && dc.value === bc.value && dc.unit === bc.unit,
    );
    if (!match) {
      flags.push({
        code: 'LLM_REMOVED_CONSTRAINT',
        severity: 'block',
        span: bc.sourceSpan,
        detail: `Обязательное ограничение «${bc.sourceSpan}» отсутствует в черновике`,
        baselineSpan: bc.sourceSpan,
      });
    }
  }

  // Rule 3. LLM_ADDED_NUMBER
  const draftCitations = extractCitations(D);
  const draftMeasured = extractMeasuredNumbers(D);
  const draftBare = extractBareIntegers(D, draftMeasured, draftCitations);
  const allowedBag = allowedNumberBag(pack, B);

  const allDraftNumbers = [...draftMeasured, ...draftBare];
  for (const num of allDraftNumbers) {
    const isBaselineConstraintVal = baselineConstraints.some(
      (bc) => bc.value === num.value && (num.unit == null || bc.unit === num.unit),
    );
    if (!isBaselineConstraintVal && !numberInBag(num, allowedBag)) {
      const isBlock = num.unit !== null || CITATION_SHAPE.test(num.span);
      flags.push({
        code: 'LLM_ADDED_NUMBER',
        severity: isBlock ? 'block' : 'warn',
        span: num.span,
        detail: `Необоснованное число: «${num.span}»`,
      });
    }
  }

  // Rule 4. LLM_INVENTED_NORM (block)
  for (const cit of draftCitations) {
    if (cit.id !== null) {
      if (!pack.allowedCitationIds.includes(cit.id)) {
        flags.push({
          code: 'LLM_INVENTED_NORM',
          severity: 'block',
          span: cit.span,
          detail: `Ссылка на неподтверждённый нормативный акт: «${cit.span}»`,
        });
      }
    } else {
      const isAllowed = pack.allowedCitationTexts.some((text) =>
        normalizeCitationText(text).includes(normalizeCitationText(cit.span)),
      );
      if (!isAllowed) {
        flags.push({
          code: 'LLM_INVENTED_NORM',
          severity: 'block',
          span: cit.span,
          detail: `Ссылка на неподтверждённый нормативный акт: «${cit.span}»`,
        });
      }
    }
  }

  // Rule 5. LLM_CHANGED_MODALITY
  const modB = extractModality(B);
  const modD = extractModality(D);

  if (modB.must + modB.mustNot > 0 && modD.must + modD.mustNot === 0 && modD.may > 0) {
    flags.push({
      code: 'LLM_CHANGED_MODALITY',
      severity: 'block',
      span: 'может',
      detail: 'Ослабление обязательного требования: формулировка изменена на рекомендательную',
    });
  } else if (modB.mustNot > modD.mustNot) {
    flags.push({
      code: 'LLM_CHANGED_MODALITY',
      severity: 'block',
      span: 'снят запрет',
      detail: 'Снято прямое запрещающее требование',
    });
  } else if (modD.must > modB.must && modB.may > 0) {
    flags.push({
      code: 'LLM_CHANGED_MODALITY',
      severity: 'warn',
      span: 'должна',
      detail: 'Усиление рекомендации до обязательного требования',
    });
  }

  // Stable sort: by code, then by span
  return flags.sort((a, b) => {
    const codeDiff = a.code.localeCompare(b.code);
    if (codeDiff !== 0) return codeDiff;
    return a.span.localeCompare(b.span);
  });
}
