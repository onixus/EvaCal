/**
 * #101 этап 3: связь позиций спецификации с требованиями ТЗ.
 *
 * Требования живут в снимке комплекта ГОСТ 34 (черновик студии или последний
 * комплект расчета) и развиваются независимо от спецификации. Поэтому связь — это
 * ID требования; неизвестный ID при сохранении дает предупреждение, а не ошибку.
 * Коды требований копируются в редакцию спецификации (requirementCodes), чтобы ее
 * документы печатали обоснование без обращения к текущему комплекту.
 */
import type { SpecificationItem, SpecificationSnapshot } from './types';
import type { Gost34RequirementItem } from '../gost34/types';

export interface RequirementOption {
  id: string;
  code: string;
  title: string;
  category: string;
  description: string;
}

export interface RequirementSource {
  kind: 'draft' | 'package';
  packageId: string;
  version: number;
  status: string;
}

export interface RequirementOptions {
  source: RequirementSource | null;
  requirements: RequirementOption[];
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Требования снимка комплекта (Gost34RequirementItem или v2) → варианты выбора. */
export function requirementOptionsFromSnapshot(snapshot: unknown): RequirementOption[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const list = (snapshot as { requirements?: unknown }).requirements;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const options: RequirementOption[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      code: str(r.code) || id,
      title: str(r.title) || str(r.description) || str(r.originalText),
      category: str(r.category),
      description: str(r.description) || str(r.normalizedText) || str(r.originalText),
    });
  }
  return options;
}

/** Все ID требований, на которые ссылаются строки (без проверки формата). */
export function linkedRequirementIds(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const ids = new Set<string>();
  for (const item of items) {
    const list = (item as { requirementIds?: unknown } | null)?.requirementIds;
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') ids.add(id);
  }
  return [...ids];
}

/**
 * Предупреждения о связях с требованиями, которых нет в комплекте. Не блокируют
 * сохранение: требование могли переименовать, удалить или еще не перенести в студию.
 */
export function requirementLinkWarnings(
  items: Pick<SpecificationItem, 'id' | 'name' | 'requirementIds' | 'requirementCodes'>[],
  options: RequirementOptions,
): string[] {
  const known = new Set(options.requirements.map((r) => r.id));
  const warnings: string[] = [];
  for (const item of items) {
    const missing = (item.requirementIds ?? []).filter((id) => !known.has(id));
    if (!missing.length) continue;
    const labels = missing.map((id) => item.requirementCodes?.[id] || id).join(', ');
    warnings.push(
      options.source
        ? `${item.name || item.id}: требования ${labels} не найдены в комплекте ГОСТ 34 (${options.source.kind === 'draft' ? 'черновик' : 'комплект'} v${options.source.version}); связь сохранена, проверьте обоснование.`
        : `${item.name || item.id}: комплект ГОСТ 34 с требованиями не найден, связи с ${labels} сохранены без проверки.`,
    );
  }
  return warnings;
}

/**
 * Коды требований для новой редакции: из комплекта для найденных ID; для ID,
 * исчезнувших из комплекта, — код из предыдущей редакции этой строки (требование
 * развивается, обоснование не теряется). Клиентские коды не принимаются.
 */
export function applyRequirementCodes(
  snapshot: SpecificationSnapshot,
  previous: SpecificationSnapshot | null,
  options: RequirementOptions,
): SpecificationSnapshot {
  const byId = new Map(options.requirements.map((r) => [r.id, r.code]));
  const before = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      const { requirementCodes: _client, ...rest } = item;
      void _client;
      if (!item.requirementIds?.length) return rest;
      const codes: Record<string, string> = {};
      for (const id of item.requirementIds) {
        const code = byId.get(id) ?? before.get(item.id)?.requirementCodes?.[id];
        if (code) codes[id] = code;
      }
      return Object.keys(codes).length ? { ...rest, requirementCodes: codes } : rest;
    }),
  };
}

/** Строка обоснования для документов: «ТР-Ф-01, ТР-Ф-02» (коды из снимка, иначе ID). */
export function requirementBasisText(
  item: Pick<SpecificationItem, 'requirementIds' | 'requirementCodes'>,
): string {
  return (item.requirementIds ?? []).map((id) => item.requirementCodes?.[id] || id).join(', ');
}

/**
 * Требования комплекта в форме генератора ГОСТ 34: общий источник матрицы
 * прослеживаемости для вкладки «Трассируемость» и XLSX расчета.
 */
export function requirementItemsFromOptions(
  options: RequirementOptions | null | undefined,
): Gost34RequirementItem[] {
  return (options?.requirements ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    category: (r.category || 'functional') as Gost34RequirementItem['category'],
    title: r.title,
    description: r.description,
  }));
}
