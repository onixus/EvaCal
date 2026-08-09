import { Gost34RequirementItem } from '../types';
import {
  Gost34RequirementV2,
  fromGost34RequirementItems,
  toGost34RequirementItems,
} from '../requirements';

export interface CleaningStats {
  originalLength: number;
  cleanedLength: number;
  removedGarbageChars: number;
  removedBoilerplateLines: number;
  extractedCount: number;
}

/**
 * Cleans unstructured Russian text by stripping binary artifacts, zero-width spaces,
 * header/footer boilerplate, and normalizing tabs/whitespace.
 */
export function sanitizeRawText(rawText: string): {
  text: string;
  stats: CleaningStats;
} {
  const originalLength = rawText.length;

  // 1. Remove control characters, zero-width spaces, BOM, soft hyphens
  let text = rawText
    .replace(/\uFEFF/g, '') // BOM
    .replace(/\u200B/g, '') // Zero-width space
    .replace(/\u00AD/g, '') // Soft hyphen
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Control chars except \n (\x0A) and \t (\x09)

  const garbageCount = originalLength - text.length;

  // 2. Remove common header/footer boilerplate (e.g. "Стр. 1 из 45", "Конфиденциально", "Draft v1.0")
  const lines = text.split(/\r?\n/);
  let removedBoilerplateCount = 0;

  const boilerplateRegex =
    /^(стр\.?\s*\d+\s*(из|\/)\s*\d+|конфиденциально|черновик|draft\s*v?\d+|коммерческая\s*тайна|дисклеймер|страница\s*\d+)$/i;

  const cleanedLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (boilerplateRegex.test(trimmed)) {
      removedBoilerplateCount++;
      return false;
    }
    return true;
  });

  // 3. Normalize multiple tabs & multiple newlines
  text = cleanedLines
    .join('\n')
    .replace(/\t+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  return {
    text,
    stats: {
      originalLength,
      cleanedLength: text.length,
      removedGarbageChars: garbageCount,
      removedBoilerplateLines: removedBoilerplateCount,
      extractedCount: 0,
    },
  };
}

/**
 * Categorizes a requirement description into GOST 34 standard categories.
 */
export function detectRequirementCategory(text: string): Gost34RequirementItem['category'] {
  const lower = text.toLowerCase();

  if (
    lower.includes('безопасн') ||
    lower.includes('защит') ||
    lower.includes('авториз') ||
    lower.includes('парол') ||
    lower.includes('шифр') ||
    lower.includes('доступ') ||
    lower.includes('фстэк') ||
    lower.includes('иббс') ||
    lower.includes('аутентифик') ||
    lower.includes('персонал')
  ) {
    return 'security';
  }

  if (
    lower.includes('надежн') ||
    lower.includes('отказ') ||
    lower.includes('дублир') ||
    lower.includes('резерв') ||
    lower.includes('бэкап') ||
    lower.includes('восстановл') ||
    lower.includes('sla') ||
    lower.includes('доступност') ||
    lower.includes('rto') ||
    lower.includes('rpo')
  ) {
    return 'reliability';
  }

  if (
    lower.includes('производит') ||
    lower.includes('скорост') ||
    lower.includes('отклик') ||
    lower.includes('нагрузк') ||
    lower.includes('rps') ||
    lower.includes('tps') ||
    lower.includes('задержк') ||
    lower.includes('ms') ||
    lower.includes('мс')
  ) {
    return 'performance';
  }

  if (
    lower.includes('интерфейс') ||
    lower.includes('удобств') ||
    lower.includes('эргоном') ||
    lower.includes('wcag') ||
    lower.includes('экран') ||
    lower.includes('пользовател')
  ) {
    return 'ergonomics';
  }

  if (
    lower.includes('субд') ||
    lower.includes('сервер') ||
    lower.includes('операционн') ||
    lower.includes('ос') ||
    lower.includes('программн') ||
    lower.includes('окружен') ||
    lower.includes('совместим') ||
    lower.includes('linux') ||
    lower.includes('postgres')
  ) {
    return 'technical';
  }

  return 'functional';
}

/**
 * Normalizes raw extracted vendor requirement items into standardized GOST 34 items:
 * - Generates clean incrementing requirement codes (ТР-ФУНК-01, ТР-БЕЗ-01, etc.)
 * - Trims whitespace and strips lead bullets (•, -, 1.1., etc.)
 * - Auto-detects requirement category
 */
export function normalizeRequirementItems(items: Gost34RequirementItem[]): Gost34RequirementItem[] {
  const normalized = normalizeRequirementItemsV2(fromGost34RequirementItems(items));
  // The cleaned wording has not been reviewed by anybody yet, so it lives in
  // normalizedText and has to be requested explicitly.
  return toGost34RequirementItems(normalized, { preferNormalized: true });
}

/**
 * Same cleaning, on the v2 model: the cleaned wording goes to `normalizedText`
 * and `originalText` is left exactly as it came out of the source document.
 */
export function normalizeRequirementItemsV2(
  requirements: Gost34RequirementV2[],
): Gost34RequirementV2[] {
  const categoryCounters: Record<string, number> = {
    functional: 1,
    security: 1,
    reliability: 1,
    performance: 1,
    ergonomics: 1,
    technical: 1,
  };

  const categoryPrefixes: Record<string, string> = {
    functional: 'ТР-ФУНК',
    security: 'ТР-БЕЗ',
    reliability: 'ТР-НАД',
    performance: 'ТР-ПРОИЗ',
    ergonomics: 'ТР-ЭРГ',
    technical: 'ТР-ТЕХ',
  };

  return requirements.map((requirement) => {
    const sourceText = requirement.normalizedText ?? requirement.originalText;

    // 1. Strip leading bullets, numbering, and dashes from title
    let cleanTitle = requirement.title
      .replace(/^[\s•\-–—*#\d\.\)\(\[\]]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanTitle) {
      cleanTitle = sourceText.substring(0, 60) || 'Требование вендора';
    }

    // 2. Strip leading bullets from description
    let cleanDesc = sourceText
      .replace(/^[\s•\-–—*#\d\.\)\(\[\]]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanDesc) {
      cleanDesc = cleanTitle;
    }

    // 3. Auto-detect category if general or missing
    const category = detectRequirementCategory(`${cleanTitle} ${cleanDesc}`);

    // 4. Generate structured code if default or unformatted
    let code = requirement.code;
    if (!code || code.startsWith('ТР-ВЕНД') || code.startsWith('REQ-') || !code.includes('-')) {
      const catCount = categoryCounters[category] || 1;
      categoryCounters[category] = catCount + 1;
      code = `${categoryPrefixes[category]}-${String(catCount).padStart(2, '0')}`;
    }

    return {
      ...requirement,
      code,
      category,
      title: cleanTitle,
      normalizedText: cleanDesc,
    };
  });
}
