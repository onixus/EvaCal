import type { Gost34Section } from '../types';

// Только многоуровневый номер пункта («4.1 », «3.2.1. »). Голое число в начале
// абзаца («30 минут RTO…», «2 контура…») — часть текста, его не срезаем.
const CLAUSE_PREFIX = /^\d+(?:\.\d+)+\.?\s+/;

export function stripClausePrefix(text: string): string {
  return text.replace(CLAUSE_PREFIX, '').trim();
}

export interface SectionOverride {
  title?: string;
  /** Заменяет текст раздела. */
  paragraphs?: string[];
  /**
   * Дописывается после текста раздела (сгенерированного или заменённого):
   * фрагменты наборов решений (#103 WP-7b). Нумерация пунктов продолжается.
   */
  appendParagraphs?: string[];
}

export function applySectionOverrides(
  sections: Gost34Section[],
  overrides: Record<string, SectionOverride>,
): Gost34Section[] {
  return sections.map((sec) => {
    const override = overrides[sec.id] ?? overrides[sec.title];
    const raw = override?.paragraphs;
    // Дополнения собираются с обоих ключей раздела (id и заголовок).
    const append = [
      ...(overrides[sec.id]?.appendParagraphs ?? []),
      ...(sec.title !== sec.id ? (overrides[sec.title]?.appendParagraphs ?? []) : []),
    ];
    const numbered = (list: string[]) =>
      list
        .map(stripClausePrefix)
        .filter(Boolean)
        .map((p, i) => `${sec.numStr}.${i + 1} ${p}`);
    const paragraphs = raw
      ? numbered([...raw, ...append])
      : append.length > 0
        ? numbered([...sec.paragraphs, ...append])
        : sec.paragraphs;
    return {
      ...sec,
      title: override?.title ?? sec.title,
      paragraphs,
      subsections: sec.subsections ? applySectionOverrides(sec.subsections, overrides) : undefined,
    };
  });
}
