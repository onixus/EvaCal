/**
 * Разделы ТЗ (ГОСТ 34.602-2020), к которым набор решений дописывает фрагменты
 * (#103 WP-7b). `sectionKey` фрагмента при применении приводится к id
 * раздела схемы — в документе дополнения ищутся по id.
 */
import { TZ_SCHEMA_2020 } from '@/lib/gost34/schema/tz34-2020';
import type { SchemaNode } from '@/lib/gost34/schema/types';

function collect(nodes: SchemaNode[], out: { id: string; title: string }[]) {
  for (const n of nodes) {
    out.push({ id: n.id, title: n.title });
    if (n.children) collect(n.children, out);
  }
  return out;
}

let cachedSections: { id: string; title: string }[] | null = null;

/** Разделы ТЗ (ГОСТ 34.602-2020), к которым можно дописывать фрагменты. */
export function tzSectionCatalog(): { id: string; title: string }[] {
  return (cachedSections ??= collect(TZ_SCHEMA_2020.nodes, []));
}

/**
 * Ключи разделов первых встроенных наборов (до привязки к схеме): `scope` —
 * назначение системы, `standards` — источники разработки.
 */
const LEGACY_SECTION_KEYS: Record<string, string> = {
  scope: 'tz2020-goals-purpose',
  standards: 'tz2020-sources',
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

/** sectionKey фрагмента → id раздела схемы (по id, заголовку или прежнему ключу); null — нет такого. */
export function resolveTzSectionId(sectionKey: string): string | null {
  const catalog = tzSectionCatalog();
  if (catalog.some((s) => s.id === sectionKey)) return sectionKey;
  const legacy = LEGACY_SECTION_KEYS[sectionKey];
  if (legacy && catalog.some((s) => s.id === legacy)) return legacy;
  const byTitle = catalog.find((s) => norm(s.title) === norm(sectionKey));
  return byTitle?.id ?? null;
}
