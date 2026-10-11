// Proposals to add a manual project row to the shared catalog. Creating one never
// changes the project; acceptance creates a new catalog product (and optionally an
// unconfirmed offer) and leaves the project row untouched.
import { prisma } from '../prisma';
import { loadSpecification } from '../specification/store';
import { SpecificationError } from '../specification/validation';
import type { SpecificationItem } from '../specification/types';
import { mutateCatalog } from './store';
import { object, revision, text } from './validation';
import {
  SUGGESTION_STATUSES,
  type CatalogSuggestion,
  type SuggestionStatus,
} from './suggestion-types';
export * from './suggestion-types';
import { Prisma } from '../generated/prisma/client';

type Row = Prisma.CatalogSuggestionGetPayload<object>;
function map(row: Row): CatalogSuggestion {
  return {
    ...row,
    itemSnapshot: row.itemSnapshot as unknown as SpecificationItem,
    status: row.status as SuggestionStatus,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

/** Proposes a saved manual row (not unsaved client data) of a specification revision. */
export async function createSuggestion(calculationId: string, input: unknown, actorId: string) {
  const d = object(input);
  const version = revision(d.version);
  const itemId = text(d.itemId, 'Строка', 100, true);
  const saved = await loadSpecification(calculationId, version);
  if (!saved) throw new SpecificationError('Редакция спецификации не найдена', 404);
  const item = saved.snapshot.items.find((row) => row.id === itemId);
  if (!item) throw new SpecificationError('Строка не найдена в сохраненной редакции', 404);
  if (item.origin)
    throw new SpecificationError('Строка уже получена из каталога; предложение не требуется', 409);
  if (!item.name) throw new SpecificationError('Укажите наименование позиции', 400);
  return prisma.$transaction(async (tx) => {
    // One pending proposal per project row; serialized per calculation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-suggestion:${calculationId}`}))`;
    const pending = await tx.catalogSuggestion.findMany({
      where: { calculationId, status: 'pending' },
      select: { itemSnapshot: true },
    });
    if (pending.some((p) => (p.itemSnapshot as { id?: string } | null)?.id === item.id))
      throw new SpecificationError('Эта позиция уже ожидает рассмотрения', 409);
    return map(
      await tx.catalogSuggestion.create({
        data: {
          calculationId,
          specificationVersion: version,
          itemSnapshot: JSON.parse(JSON.stringify(item)),
          createdBy: actorId,
        },
      }),
    );
  });
}

export async function listSuggestions(status?: string | null) {
  if (status && !(SUGGESTION_STATUSES as readonly string[]).includes(status))
    throw new SpecificationError('Некорректный статус');
  const rows = await prisma.catalogSuggestion.findMany({
    where: status ? { status } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  return rows.map(map);
}

/** accept → new product (+ optional unconfirmed offer); reject → comment. Pending only. */
export async function reviewSuggestion(input: unknown, reviewerId: string) {
  const d = object(input);
  const id = text(d.id, 'Предложение', 100, true);
  if (d.action !== 'accept' && d.action !== 'reject')
    throw new SpecificationError('Неизвестное действие');
  // The comment is the reviewer's decision note.
  const comment = d.comment === undefined ? '' : text(d.comment, 'Комментарий', 1000);
  if (d.action === 'reject' && !comment) throw new SpecificationError('Укажите причину отклонения');
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM "CatalogSuggestion" WHERE id = ${id} FOR UPDATE
    `;
    if (!locked.length) throw new SpecificationError('Предложение не найдено', 404);
    if (locked[0].status !== 'pending')
      throw new SpecificationError('Предложение уже рассмотрено', 409);
    let createdProductId: string | null = null;
    let offerId: string | null = null;
    if (d.action === 'accept') {
      const product = await mutateCatalog(
        { action: 'product.create', product: d.product },
        reviewerId,
        tx,
      );
      createdProductId = product.id;
      if (d.offer !== undefined && d.offer !== null) {
        // Manual offers are created unconfirmed; confirmation is a separate action.
        const offer = await mutateCatalog(
          { action: 'offer.create', id: product.id, revision: 1, offer: d.offer },
          reviewerId,
          tx,
        );
        offerId = offer.id;
      }
    }
    const row = await tx.catalogSuggestion.update({
      where: { id },
      data: {
        status: d.action === 'accept' ? 'accepted' : 'rejected',
        reviewer: reviewerId,
        reviewedAt: new Date(),
        comment,
        createdProductId,
      },
    });
    return { ...map(row), offerId };
  });
}
