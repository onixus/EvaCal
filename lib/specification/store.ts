import { prisma } from '../prisma';
import type { Prisma } from '../generated/prisma/client';
import {
  parseSpecification,
  requireConfirmedSpecification,
  SpecificationError,
} from './validation';
import { catalogItem, withoutPriceConfirmation } from '../catalog/snapshot';
import type { Product } from '../catalog/types';
import type { SavedSpecification, SpecificationSnapshot } from './types';
import { snapshotEvidence } from '../catalog/compliance';
import { mapEvidence } from '../catalog/store';
import { clearStaleChangeReasons } from './diff';
import { verifySizingRefs } from '../sizing/refs';

export async function loadSpecification(
  calculationId: string,
  version?: number,
): Promise<SavedSpecification | null> {
  const row = await prisma.specificationVersion.findFirst({
    where: { calculationId, ...(version === undefined ? {} : { version }) },
    orderBy: { version: 'desc' },
  });
  if (!row) return null;
  const snapshot = parseSpecification(JSON.parse(row.data));
  // The revision data stays byte-for-byte immutable; release is tracked in the row status.
  if (row.status === 'released') snapshot.status = 'released';
  return {
    id: row.id,
    snapshot,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/**
 * Compliance evidence is copied by the server, never taken from the client: a row
 * that stays confirmed with the same catalog origin keeps the copy of the previous
 * revision; a new, changed or newly confirmed catalog row gets the current evidence
 * of its product. Manual rows carry no evidence. Saved revisions are never rewritten.
 */
async function attachEvidence(
  tx: Prisma.TransactionClient,
  previous: SpecificationSnapshot | null,
  snapshot: SpecificationSnapshot,
) {
  const old = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  const fresh = new Set<string>();
  for (const item of snapshot.items) {
    const before = old.get(item.id);
    const keep =
      item.origin &&
      before?.origin &&
      before.confirmed &&
      item.confirmed &&
      JSON.stringify(before.origin) === JSON.stringify(item.origin);
    delete item.evidence;
    if (keep) {
      if (before.evidence) item.evidence = before.evidence;
    } else if (item.origin) fresh.add(item.origin.productId);
  }
  if (!fresh.size) return;
  const rows = await tx.complianceEvidence.findMany({
    where: { productId: { in: [...fresh] }, archivedAt: null },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
  });
  for (const item of snapshot.items) {
    if (!item.origin || item.evidence || !fresh.has(item.origin.productId)) continue;
    const evidence = rows
      .filter((row) => row.productId === item.origin!.productId)
      .map((row) => snapshotEvidence(mapEvidence(row)));
    if (evidence.length) item.evidence = evidence;
  }
}

/** Serialize writes per calculation; stale editors cannot overwrite another revision. */
export async function saveSpecification(
  calculationId: string,
  input: unknown,
  actorId: string,
  options: {
    allowOriginUpdates?: boolean;
    allowNewCatalogOrigins?: boolean;
    /** Extra checks inside the write transaction (after the version lock). */
    beforeWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
  } = {},
) {
  const snapshot = parseSpecification(input);
  if (snapshot.status === 'released')
    throw new SpecificationError(
      'Статус «выпущена» присваивается только при выпуске комплекта ГОСТ 34. Новая редакция сохраняется как черновик, на согласовании или подтвержденная.',
    );
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
        const projectSources =
          previous?.items.filter(
            (row) => JSON.stringify(row.origin) === JSON.stringify(item.origin),
          ) ?? [];
        if (projectSources.length) {
          // A copied row must not erase a manual decision by changing its ID.
          if (projectSources.some((row) => row.priceOverride === true)) item.priceOverride = true;
          continue;
        }
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
        const historicalProduct = offer
          ? {
              ...product,
              revision: offer.productRevision,
              archived: false,
              vendor: { ...product.vendor, archived: false },
            }
          : product;
        const expected = catalogItem(historicalProduct, offer, item.id);
        const normalized = parseSpecification({ ...snapshot, items: [expected] }).items[0].origin;
        if (
          JSON.stringify(withoutPriceConfirmation(normalized)) !==
          JSON.stringify(withoutPriceConfirmation(item.origin))
        )
          throw new SpecificationError(
            'Каталожное происхождение не соответствует сохраненному предложению',
            409,
          );
      }
    }
    // Связи с сайзингом проверяются по неизменяемым прогонам этого расчета.
    await attachEvidence(tx, previous, snapshot);
    if (options.beforeWrite) await options.beforeWrite(tx);
    const sizingRunIds = await verifySizingRefs(tx, calculationId, snapshot.items);
    const { sizingRunIds: _clientRunIds, ...rest } = clearStaleChangeReasons(previous, snapshot);
    const next = {
      ...rest,
      version: snapshot.version + 1,
      ...(sizingRunIds.length ? { sizingRunIds } : {}),
    };
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

/**
 * Marks a confirmed revision as released when a GOST package is issued from it.
 * Drafts and revisions under review are never promoted; the revision data is untouched,
 * so the next edit necessarily creates a new draft revision.
 */
export async function markSpecificationReleased(
  calculationId: string,
  version: number,
  db: Pick<Prisma.TransactionClient, 'specificationVersion'> = prisma,
) {
  const result = await db.specificationVersion.updateMany({
    where: { calculationId, version, status: 'confirmed' },
    data: { status: 'released' },
  });
  return result.count;
}

/** Extracts the pinned, final revision number from a GOST package snapshot. */
export function releasedSpecificationVersion(snapshot: unknown): number | null {
  let data = snapshot;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const { specificationVersion, specification } = data as {
    specificationVersion?: unknown;
    specification?: { status?: unknown; version?: unknown } | null;
  };
  const version = Number.isSafeInteger(specificationVersion)
    ? Number(specificationVersion)
    : Number.isSafeInteger(specification?.version)
      ? Number(specification?.version)
      : null;
  if (version === null || version < 1) return null;
  return specification?.status === 'confirmed' || specification?.status === 'released'
    ? version
    : null;
}

/**
 * Runs a package write and, when the package pins a final BOM revision, marks that
 * revision released in the same transaction: either both are stored or neither.
 */
export async function withSpecificationRelease<T>(
  calculationId: string,
  version: number | null,
  write: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (version === null) return write(prisma);
  return prisma.$transaction(async (tx) => {
    const result = await write(tx);
    await markSpecificationReleased(calculationId, version, tx);
    return result;
  });
}
