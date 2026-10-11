/**
 * Дополнения разделов из наборов решений (#103 WP-7b).
 *
 * Фрагменты документов набора хранятся в снимке отдельно от ручных правок
 * разделов — реестром `kitFragments` (`origin`, `sectionKey` = id раздела
 * схемы, текст). При сборке документа они дописываются в конец раздела ПОСЛЕ
 * всех правок: сгенерированного текста, ручной замены абзацев
 * (`sectionOverrides`) и принятой прозы автора ТЗ. Поэтому правка, сброс или
 * перегенерация раздела в студии дополнения не трогают, а дополнения не
 * попадают в редактируемый текст раздела и не делают его «изменённым вручную».
 *
 * Нумерация: дописанные строки продолжают пункты раздела (`4.2.3` → `4.2.4`),
 * только если последний абзац раздела — нумерованный пункт этого раздела;
 * иначе печатаются без номера. Сгенерированные абзацы не перенумеровываются.
 */
import type { Gost34Section } from '../types';

export interface KitFragmentLike {
  origin?: { elementId?: string } | null;
  sectionKey: string;
  text: string;
}

/** Абзацы дополнения, привязанные к разделу, с происхождением. */
export interface KitAppendix {
  elementId: string;
  paragraphs: string[];
}

export function fragmentParagraphs(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Дополнения по id раздела в порядке реестра. */
export function kitAppendicesFromFragments(fragments: unknown): Record<string, KitAppendix[]> {
  const out: Record<string, KitAppendix[]> = {};
  if (!Array.isArray(fragments)) return out;
  for (const raw of fragments) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as KitFragmentLike;
    if (typeof f.sectionKey !== 'string' || typeof f.text !== 'string') continue;
    const paragraphs = fragmentParagraphs(f.text);
    if (paragraphs.length === 0) continue;
    (out[f.sectionKey] ??= []).push({
      elementId: String(f.origin?.elementId ?? ''),
      paragraphs,
    });
  }
  return out;
}

const CLAUSE = /^(\d+(?:\.\d+)+)\.?\s+/;

function appendTo(sec: Gost34Section, appendices: KitAppendix[]): Gost34Section {
  const lines = appendices.flatMap((a) => a.paragraphs);
  const paragraphs = sec.paragraphs ?? [];
  const last = paragraphs[paragraphs.length - 1];
  const m = last ? CLAUSE.exec(last) : null;
  const prefix = `${sec.numStr}.`;
  let numbered: string[];
  if (m && m[1].startsWith(prefix) && /^\d+$/.test(m[1].slice(prefix.length))) {
    const start = Number(m[1].slice(prefix.length));
    numbered = lines.map((p, i) => `${prefix}${start + i + 1} ${p}`);
  } else {
    numbered = lines;
  }
  return {
    ...sec,
    paragraphs: [...paragraphs, ...numbered],
    kitAppendix: {
      count: numbered.length,
      elementIds: appendices.map((a) => a.elementId).filter(Boolean),
    },
  };
}

/** Дописывает дополнения в разделы по id (рекурсивно, после всех правок). */
export function applyKitAppendices(
  sections: Gost34Section[],
  appendices: Record<string, KitAppendix[]>,
): Gost34Section[] {
  if (Object.keys(appendices).length === 0) return sections;
  return sections.map((sec) => {
    const own = appendices[sec.id];
    const next = own?.length ? appendTo(sec, own) : sec;
    return {
      ...next,
      subsections: sec.subsections ? applyKitAppendices(sec.subsections, appendices) : undefined,
    };
  });
}

/** Абзацы раздела, которые правит пользователь: без дописанных из наборов. */
export function editableParagraphs(
  sec: Pick<Gost34Section, 'paragraphs' | 'kitAppendix'>,
): string[] {
  const paragraphs = sec.paragraphs ?? [];
  const count = sec.kitAppendix?.count ?? 0;
  return count > 0 ? paragraphs.slice(0, Math.max(0, paragraphs.length - count)) : paragraphs;
}
