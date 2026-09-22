import type { Gost34Section } from '../types';

// Только многоуровневый номер пункта («4.1 », «3.2.1. »). Голое число в начале
// абзаца («30 минут RTO…», «2 контура…») — часть текста, его не срезаем.
const CLAUSE_PREFIX = /^\d+(?:\.\d+)+\.?\s+/;

export function stripClausePrefix(text: string): string {
  return text.replace(CLAUSE_PREFIX, '').trim();
}

export function applySectionOverrides(
  sections: Gost34Section[],
  overrides: Record<string, { title?: string; paragraphs?: string[] }>,
): Gost34Section[] {
  return sections.map((sec) => {
    const override = overrides[sec.id] ?? overrides[sec.title];
    const raw = override?.paragraphs;
    const paragraphs = raw
      ? raw.map(stripClausePrefix).filter(Boolean).map((p, i) => `${sec.numStr}.${i + 1} ${p}`)
      : sec.paragraphs;
    return {
      ...sec,
      title: override?.title ?? sec.title,
      paragraphs,
      subsections: sec.subsections ? applySectionOverrides(sec.subsections, overrides) : undefined,
    };
  });
}

