import { prisma } from '../prisma';
import { SpecificationError } from '../specification/validation';
import { object, text, revision, productInput, offerInput } from './validation';

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
      // Lock parent against concurrent archiving during creation/edit.
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
      const rows = await tx.$queryRaw<
        Array<{ archived: boolean; vendorArchived: boolean; revision: number }>
      >`SELECT p.archived, p.revision, v.archived AS "vendorArchived" FROM "CatalogProduct" p JOIN "CatalogVendor" v ON v.id = p."vendorId" WHERE p.id = ${id} FOR UPDATE OF p, v`;
      if (!rows.length || rows[0].archived || rows[0].vendorArchived)
        throw new SpecificationError('Позиция или вендор архивированы', 409);
      if (rows[0].revision !== revision(d.revision))
        throw new SpecificationError(
          'Позиция изменена. Обновите каталог перед добавлением цены.',
          409,
        );
      const offer = await tx.catalogOffer.create({
        data: { ...data, productId: id, productRevision: rows[0].revision, createdBy: actorId },
      });
      return { ...offer, unitPrice: offer.unitPrice?.toString() ?? null };
    }
    throw new SpecificationError('Неизвестное действие каталога');
  });
}
