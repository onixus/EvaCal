import { prisma } from '../prisma';
import {
  parseSpecification,
  requireConfirmedSpecification,
  SpecificationError,
} from './validation';
import { catalogItem } from '../catalog/snapshot';
import type { Product } from '../catalog/types';
import type { SavedSpecification } from './types';

export async function loadSpecification(
  calculationId: string,
  version?: number,
): Promise<SavedSpecification | null> {
  const row = await prisma.specificationVersion.findFirst({
    where: { calculationId, ...(version === undefined ? {} : { version }) },
    orderBy: { version: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    snapshot: parseSpecification(JSON.parse(row.data)),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/** Serialize writes per calculation; stale editors cannot overwrite another revision. */
export async function saveSpecification(
  calculationId: string,
  input: unknown,
  actorId: string,
  options: { allowOriginUpdates?: boolean; allowNewCatalogOrigins?: boolean } = {},
) {
  const snapshot = parseSpecification(input);
  if (snapshot.status === 'confirmed') requireConfirmedSpecification(snapshot);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Calculation" WHERE id = ${calculationId} FOR UPDATE
    `;
    if (!rows.length) throw new SpecificationError('Расчет не найден', 404);
    const latest = await tx.specificationVersion.findFirst({
      where: { calculationId },
      orderBy: { version: 'desc' },
    });
    if ((latest?.version ?? 0) !== snapshot.version) {
      throw new SpecificationError(
        'Спецификация изменена другим пользователем. Загрузите последнюю версию.',
        409,
      );
    }
    const previous = latest ? parseSpecification(JSON.parse(latest.data)) : null;
    if (!options.allowOriginUpdates) {
      for (const item of snapshot.items) {
        const old = previous?.items.find((row) => row.id === item.id);
        if (old?.origin) {
          if (JSON.stringify(item.origin) !== JSON.stringify(old.origin))
            throw new SpecificationError(
              'Происхождение строки изменяется только через проверенное обновление GPL.',
              409,
            );
          // Ordinary edits cannot clear a recorded manual-price decision.
          // The verified GPL apply path clears it only with explicit consent.
          if (old.priceOverride === true) item.priceOverride = true;
          continue;
        }
        if (!item.origin) continue;
        if (
          previous?.items.some((row) => JSON.stringify(row.origin) === JSON.stringify(item.origin))
        )
          continue; // Explicit copies of existing project rows retain their verified provenance.
        if (options.allowNewCatalogOrigins === false)
          throw new SpecificationError(
            'Для добавления каталожного происхождения нужен доступ к каталогу.',
            403,
          );
        const stored = await tx.catalogProduct.findUnique({
          where: { id: item.origin.productId },
          include: { vendor: true, offers: { where: { id: item.origin.offerId ?? '' } } },
        });
        if (!stored) throw new SpecificationError('Источник каталожной строки не найден', 409);
        const product = {
          ...stored,
          offers: stored.offers.map((offer) => ({
            ...offer,
            unitPrice: offer.unitPrice?.toString() ?? null,
          })),
        } as unknown as Product;
        const offer = item.origin.offerId
          ? product.offers.find((entry) => entry.id === item.origin!.offerId)
          : undefined;
        if (item.origin.offerId && !offer)
          throw new SpecificationError('Источник предложения не найден', 409);
        // Verify an immutable offer even if the live catalog changed after it was copied.
        const historicalProduct = {
          ...product,
          revision: offer?.productRevision ?? product.revision,
          archived: false,
          vendor: { ...product.vendor, archived: false },
        };
        const expected = catalogItem(historicalProduct, offer, item.id);
        const normalized = parseSpecification({ ...snapshot, items: [expected] }).items[0].origin;
        if (JSON.stringify(normalized) !== JSON.stringify(item.origin))
          throw new SpecificationError(
            'Каталожное происхождение не соответствует сохраненному предложению',
            409,
          );
      }
    }
    const next = { ...snapshot, version: snapshot.version + 1 };
    const row = await tx.specificationVersion.create({
      data: {
        calculationId,
        version: next.version,
        status: next.status,
        data: JSON.stringify(next),
        createdBy: actorId,
      },
    });
    return {
      id: row.id,
      snapshot: next,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    };
  });
}
