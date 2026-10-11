// Explicit «Обновить сведения реестров»: re-copies the current catalog compliance
// evidence into the selected (or all) rows of the latest revision as a new draft.
// Row facts and confirmations are untouched; released revisions stay unchanged.
import { object, revision, text } from '../catalog/validation';
import { loadSpecification, saveSpecification } from './store';
import { SpecificationError } from './validation';

export async function refreshSpecificationEvidence(
  calculationId: string,
  input: unknown,
  actorId: string,
  options: { allowNewCatalogOrigins?: boolean } = {},
) {
  const d = object(input);
  const version = revision(d.version);
  let itemIds: string[] | 'all' = 'all';
  if (d.itemIds !== undefined) {
    if (!Array.isArray(d.itemIds) || !d.itemIds.length || d.itemIds.length > 500)
      throw new SpecificationError('Выберите строки для обновления сведений');
    itemIds = d.itemIds.map((id) => text(id, 'Строка', 100, true));
  }
  const saved = await loadSpecification(calculationId);
  if (!saved || saved.snapshot.version !== version)
    throw new SpecificationError('Спецификация изменена. Обновите данные.', 409);
  const catalogRows = new Set(
    saved.snapshot.items.filter((item) => item.origin).map((item) => item.id),
  );
  if (itemIds !== 'all' && itemIds.some((id) => !catalogRows.has(id)))
    throw new SpecificationError('Сведения реестров обновляются только для позиций каталога');
  if (!catalogRows.size) throw new SpecificationError('В спецификации нет позиций каталога', 409);
  return saveSpecification(calculationId, { ...saved.snapshot, status: 'draft' }, actorId, {
    refreshEvidence: itemIds,
    ...options,
  });
}
