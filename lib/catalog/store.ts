import { prisma } from '../prisma';
import { SpecificationError } from '../specification/validation';
import { object, text, revision, productInput, offerInput } from './validation';
import type { Prisma } from '../generated/prisma/client';

async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "CatalogProduct" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new SpecificationError('Позиция не найдена', 404);
  return tx.catalogProduct.findUniqueOrThrow({ where: { id } });
}

export async function loadCatalog() {
  const [vendors, rows] = await Promise.all([
    prisma.catalogVendor.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    prisma.catalogProduct.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: { vendor: true, offers: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } },
    }),
  ]);
  return {
    vendors,
    products: rows.map((p) => ({
      ...p,
      offers: p.offers.map((o) => ({ ...o, unitPrice: o.unitPrice?.toString() ?? null })),
    })),
  };
}
export async function mutateCatalog(input: unknown, actorId: string) {
  const d = object(input);
  return prisma.$transaction(async (tx) => {
    if (d.action === 'vendor.create')
      return tx.catalogVendor.create({
        data: { name: text(d.name, 'Вендор', 200, true), createdBy: actorId },
      });
    const id = d.action === 'product.create' ? '' : text(d.id, 'ID', 100, true);
    if (d.action === 'vendor.update' || d.action === 'vendor.archive') {
      const result = await tx.catalogVendor.updateMany({
        where: { id, revision: revision(d.revision) },
        data: {
          ...(d.action === 'vendor.update'
            ? { name: text(d.name, 'Вендор', 200, true) }
            : { archived: true }),
          revision: { increment: 1 },
        },
      });
      if (!result.count)
        throw new SpecificationError('Вендор изменен или не найден. Обновите каталог.', 409);
      return tx.catalogVendor.findUniqueOrThrow({ where: { id } });
    }
    if (d.action === 'product.create' || d.action === 'product.update') {
      const data = productInput(d.product);
      // Existing-product operations always lock Product → Vendor. Vendor-only
      // writes never acquire a product lock; creation has no existing product.
      if (d.action === 'product.update') {
        const current = await lockProduct(tx, id);
        if (current.archived || current.revision !== revision(d.revision))
          throw new SpecificationError('Позиция изменена или архивирована. Обновите каталог.', 409);
      }
      const vendor = await tx.$queryRaw<
        Array<{ archived: boolean }>
      >`SELECT archived FROM "CatalogVendor" WHERE id = ${data.vendorId} FOR UPDATE`;
      if (!vendor.length || vendor[0].archived)
        throw new SpecificationError('Выберите действующего вендора', 409);
      if (d.action === 'product.create')
        return tx.catalogProduct.create({
          data: { ...data, attributes: data.attributes.map((a) => ({ ...a })), createdBy: actorId },
        });
      const result = await tx.catalogProduct.updateMany({
        where: { id, revision: revision(d.revision), archived: false },
        data: {
          ...data,
          attributes: data.attributes.map((a) => ({ ...a })),
          revision: { increment: 1 },
        },
      });
      if (!result.count)
        throw new SpecificationError('Позиция изменена или архивирована. Обновите каталог.', 409);
      return tx.catalogProduct.findUniqueOrThrow({ where: { id } });
    }
    if (d.action === 'product.archive') {
      const result = await tx.catalogProduct.updateMany({
        where: { id, revision: revision(d.revision), archived: false },
        data: { archived: true, revision: { increment: 1 } },
      });
      if (!result.count)
        throw new SpecificationError('Позиция изменена или архивирована. Обновите каталог.', 409);
      return tx.catalogProduct.findUniqueOrThrow({ where: { id } });
    }
    if (d.action === 'offer.create') {
      const data = offerInput(d.offer);
      const product = await lockProduct(tx, id);
      if (product.archived) throw new SpecificationError('Позиция архивирована', 409);
      if (product.revision !== revision(d.revision))
        throw new SpecificationError(
          'Позиция изменена. Обновите каталог перед добавлением цены.',
          409,
        );
      const vendors = await tx.$queryRaw<
        Array<{ id: string; name: string; revision: number; archived: boolean }>
      >`
        SELECT id, name, revision, archived FROM "CatalogVendor" WHERE id = ${product.vendorId} FOR UPDATE
      `;
      const vendor = vendors[0];
      if (!vendor || vendor.archived) throw new SpecificationError('Вендор архивирован', 409);
      const technical = productInput(product);
      const productSnapshot = {
        ...technical,
        attributes: technical.attributes.map((a) => ({ ...a })),
        id: product.id,
        revision: product.revision,
        vendor: { id: vendor.id, name: vendor.name, revision: vendor.revision },
      };
      const offer = await tx.catalogOffer.create({
        data: {
          ...data,
          productId: id,
          productRevision: product.revision,
          productSnapshot,
          createdBy: actorId,
        },
      });
      return { ...offer, unitPrice: offer.unitPrice?.toString() ?? null };
    }
    throw new SpecificationError('Неизвестное действие каталога');
  });
}
