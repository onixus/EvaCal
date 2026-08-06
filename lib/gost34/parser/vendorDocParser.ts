import mammoth from 'mammoth';
import { Gost34RequirementItem, RequirementCategory } from '../types';

export interface ParsedVendorDocument {
  filename: string;
  rawText: string;
  extractedRequirements: Gost34RequirementItem[];
}

/**
 * Parses vendor files (.docx, .txt, .md, .json) and extracts structured requirements
 */
export async function parseVendorDocument(
  buffer: Buffer,
  filename: string
): Promise<ParsedVendorDocument> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  let rawText = '';

  if (ext === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value || '';
    } catch (e) {
      rawText = buffer.toString('utf-8');
    }
  } else if (ext === 'json') {
    const str = buffer.toString('utf-8');
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        rawText = parsed.map((item) => JSON.stringify(item)).join('\n');
      } else {
        rawText = str;
      }
    } catch (e) {
      rawText = str;
    }
  } else {
    // .txt, .md, etc.
    rawText = buffer.toString('utf-8');
  }

  const extractedRequirements = extractRequirementsFromText(rawText, filename);

  return {
    filename,
    rawText,
    extractedRequirements,
  };
}

/**
 * Heuristic requirement extraction logic from vendor specification text.
 * Searches for lines containing "ТР-", "ФТ-", "ТТ-", "Требование", "Должен", "Система должна",
 * numbered lists, or section headers.
 */
export function extractRequirementsFromText(
  text: string,
  sourceFile: string
): Gost34RequirementItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const requirements: Gost34RequirementItem[] = [];
  let reqIndex = 1;

  let currentCategory: RequirementCategory = 'functional';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section categories
    if (/безопасн|шифров|авториз|права док/i.test(line)) {
      currentCategory = 'security';
    } else if (/производительн|нагруз|откли|время реакц/i.test(line)) {
      currentCategory = 'performance';
    } else if (/надежн|отказоустойч|резерв|восстановл/i.test(line)) {
      currentCategory = 'reliability';
    } else if (/интерфейс|эргоном|удобств|wcag/i.test(line)) {
      currentCategory = 'ergonomics';
    } else if (/технич|сервер|субд|бд|архитектур/i.test(line)) {
      currentCategory = 'technical';
    }

    // Match requirement pattern (e.g. "ТР-Ф-01", "1.1.", "Система должна...", "Требование к...")
    const isExplicitCode = /(ТР|ФТ|ТТ|БР|REQ|REQ-)[-A-Za-z0-9_.]+/i.test(line);
    const isRequirementSentence = /должн(а|о|ы)|обязан(а|о|ы)|требование|обеспечивает/i.test(line);
    const isNumberedItem = /^\d+(\.\d+)*[\s\)\.-]/.test(line);

    if ((isExplicitCode || isRequirementSentence) && line.length > 15) {
      // Extract code if present or generate standard code
      const codeMatch = line.match(/(ТР|ФТ|ТТ|БР|REQ)[-A-Za-z0-9_.]+/i);
      const code = codeMatch
        ? codeMatch[0].toUpperCase()
        : `ТР-ВЕНД-${String(reqIndex).padStart(2, '0')}`;

      // Clean up tab stops and multiple spaces
      const cleanLine = line.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();

      // Preserve FULL title without arbitrary character truncation
      const title = cleanLine;
      const description = cleanLine;

      requirements.push({
        id: `req-vendor-${reqIndex}`,
        code,
        category: currentCategory,
        title,
        description,
        sourceFile,
      });

      reqIndex++;
    }
  }

  // Fallback: If no explicit requirements found, split text into logical paragraphs as requirements
  if (requirements.length === 0 && lines.length > 0) {
    lines.slice(0, 15).forEach((line, idx) => {
      if (line.length > 20) {
        requirements.push({
          id: `req-vendor-fallback-${idx + 1}`,
          code: `ТР-ВЕНД-${String(idx + 1).padStart(2, '0')}`,
          category: 'functional',
          title: `Вендорское требование № ${idx + 1}`,
          description: line,
          sourceFile,
        });
      }
    });
  }

  return requirements;
}
