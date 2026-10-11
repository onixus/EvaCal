import { prisma } from '../prisma';
import { SpecificationError } from '../specification/validation';
import { object, text, revision, productInput, offerInput } from './validation';
import { Prisma } from '../generated/prisma/client';
import { checkRelation, relationInput, type ProductRelation } from './relations';
import {
  attributeDefinitionInput,
  attributeFlags,
  checkAttributes,
  type AttributeDefinition,
} from './attributes';
import type { Attribute } from './types';
import { evidenceInput, type ComplianceEvidence } from './compliance';

type EvidenceRow = Prisma.ComplianceEvidenceGetPayload<object>;
export function mapEvidence(row: EvidenceRow): ComplianceEvidence {
  return {
    id: row.id,
    productId: row.productId,
    productRevision: row.productRevision,
    type: row.type as ComplianceEvidence['type'],
    number: row.number,
    issuer: row.issuer,
    sourceUrl: row.sourceUrl,
    checkedAt: row.checkedAt,
    checkedBy: row.checkedBy,
    validUntil: row.validUntil,
    status: row.status as ComplianceEvidence['status'],
    applicability: row.applicability,
    note: row.note,
    revision: row.revision,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

type DefinitionRow = Prisma.CatalogAttributeDefinitionGetPayload<object>;
type RelationRow = Prisma.CatalogProductRelationGetPayload<object>;
export function mapDefinition(row: DefinitionRow): AttributeDefinition {
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    valueType: row.valueType as AttributeDefinition['valueType'],
    unit: row.unit,
    allowedUnits: strings(row.allowedUnits),
    enumValues: strings(row.enumValues),
    archived: row.archived,
    revision: row.revision,
  };
}
export function mapRelation(row: RelationRow): ProductRelation {
  return {
    id: row.id,
    fromProductId: row.fromProductId,
    toProductId: row.toProductId,
    type: row.type as ProductRelation['type'],
    quantity: row.quantity?.toString() ?? null,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedBy: row.archivedBy,
  };
}
/**
 * A kind change must keep active bundle composition consistent: a bundle with
 * components cannot stop being a bundle, and a component cannot become a bundle.
 * The relations are archived explicitly first (409 with a clear message otherwise).
 */
export async function requireKindCompatibleWithRelations(
  tx: Prisma.TransactionClient,
  productId: string,
  oldKind: string,
  newKind: string,
) {
  if (oldKind === newKind) return;
  if (oldKind === 'bundle') {
    const components = await tx.catalogProductRelation.count({
      where: { fromProductId: productId, type: 'bundleComponent', archivedAt: null },
    });
    if (components)
      throw new SpecificationError(
        `Позиция — комплект с компонентами (${components}): архивируйте связи состава перед сменой типа.`,
        409,
      );
  }
  if (newKind === 'bundle') {
    const parents = await tx.catalogProductRelation.count({
      where: { toProductId: productId, type: 'bundleComponent', archivedAt: null },
    });
    if (parents)
      throw new SpecificationError(
        'Позиция входит в состав комплекта и не может стать комплектом: вложенные комплекты не поддерживаются. Архивируйте связь состава.',
        409,
      );
  }
}
/** Manual writes must satisfy existing definitions; unknown attributes stay allowed. */
async function requireValidAttributes(tx: Prisma.TransactionClient, attributes: Attribute[]) {
  if (!attributes.length) return;
  const definitions = (
    await tx.catalogAttributeDefinition.findMany({ where: { archived: false } })
  ).map(mapDefinition);
  const { errors } = checkAttributes(attributes, definitions);
  if (errors.length) throw new SpecificationError(errors.join('\n'));
}

async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "CatalogProduct" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new SpecificationError('Позиция не найдена', 404);
  return tx.catalogProduct.findUniqueOrThrow({ where: { id } });
}

export async function loadCatalog() {
  const [vendors, rows, relations, definitionRows] = await Promise.all([
    prisma.catalogVendor.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    prisma.catalogProduct.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        vendor: true,
        offers: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        evidence: {
          where: { archivedAt: null },
          orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        },
      },
    }),
    prisma.catalogProductRelation.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.catalogAttributeDefinition.findMany({ orderBy: [{ label: 'asc' }, { id: 'asc' }] }),
  ]);
  const attributeDefinitions = definitionRows.map(mapDefinition);
  return {
    vendors,
    relations: relations.map(mapRelation),
    attributeDefinitions,
    products: rows.map((p) => ({
      ...p,
      attributeFlags: attributeFlags(p.attributes as unknown as Attribute[], attributeDefinitions),
      evidence: p.evidence.map(mapEvidence),
      offers: p.offers.map((o) => ({
        ...o,
        unitPrice: o.unitPrice?.toString() ?? null,
        taxRate: o.taxRate?.toString() ?? null,
      })),
    })),
  };
}
/** Runs in its own transaction, or inside `db` when composed (suggestion acceptance). */
export async function mutateCatalog(
  input: unknown,
  actorId: string,
  db?: Prisma.TransactionClient,
) {
  const d = object(input);
  const run = async (tx: Prisma.TransactionClient) => {
    if (d.action === 'vendor.create')
      return tx.catalogVendor.create({
        data: { name: text(d.name, 'Вендор', 200, true), createdBy: actorId },
      });
    if (d.action === 'relation.create') return createRelation(tx, d.relation, actorId);
    if (d.action === 'evidence.create') {
      // Evidence is recorded against the product's current revision; the checker is the actor.
      const productId = text(d.productId, 'Позиция', 100, true);
      const data = evidenceInput(d.evidence);
      const product = await lockProduct(tx, productId);
      if (product.archived)
        throw new SpecificationError('Позиция архивирована: подтверждения не добавляются', 409);
      return mapEvidence(
        await tx.complianceEvidence.create({
          data: {
            ...data,
            productId,
            productRevision: product.revision,
            checkedBy: actorId,
            createdBy: actorId,
          },
        }),
      );
    }
    if (d.action === 'evidence.update' || d.action === 'evidence.archive') {
      const evidenceId = text(d.id, 'Подтверждение', 100, true);
      const data = d.action === 'evidence.update' ? evidenceInput(d.evidence) : null;
      const result = await tx.complianceEvidence.updateMany({
        where: { id: evidenceId, revision: revision(d.revision), archivedAt: null },
        data: data
          ? { ...data, checkedBy: actorId, revision: { increment: 1 } }
          : { archivedAt: new Date(), archivedBy: actorId, revision: { increment: 1 } },
      });
      if (!result.count)
        throw new SpecificationError('Подтверждение изменено или в архиве. Обновите каталог.', 409);
      return mapEvidence(
        await tx.complianceEvidence.findUniqueOrThrow({ where: { id: evidenceId } }),
      );
    }
    if (d.action === 'attribute.create') {
      const data = attributeDefinitionInput(d.definition);
      const clash = await tx.catalogAttributeDefinition.findUnique({ where: { key: data.key } });
      if (clash) throw new SpecificationError('Характеристика с таким ключом уже существует', 409);
      return mapDefinition(
        await tx.catalogAttributeDefinition.create({
          data: {
            ...data,
            allowedUnits: data.allowedUnits ?? Prisma.DbNull,
            enumValues: data.enumValues ?? Prisma.DbNull,
            createdBy: actorId,
          },
        }),
      );
    }
    const id = d.action === 'product.create' ? '' : text(d.id, 'ID', 100, true);
    if (d.action === 'relation.archive') {
      const result = await tx.catalogProductRelation.updateMany({
        where: { id, archivedAt: null },
        data: { archivedAt: new Date(), archivedBy: actorId },
      });
      if (!result.count) throw new SpecificationError('Связь не найдена или уже в архиве', 409);
      return mapRelation(await tx.catalogProductRelation.findUniqueOrThrow({ where: { id } }));
    }
    if (d.action === 'attribute.update' || d.action === 'attribute.archive') {
      const data = d.action === 'attribute.update' ? attributeDefinitionInput(d.definition) : null;
      if (
        data &&
        (await tx.catalogAttributeDefinition.findFirst({ where: { key: data.key, NOT: { id } } }))
      )
        throw new SpecificationError('Характеристика с таким ключом уже существует', 409);
      const result = await tx.catalogAttributeDefinition.updateMany({
        where: { id, revision: revision(d.revision), archived: false },
        data: {
          ...(data
            ? {
                ...data,
                allowedUnits: data.allowedUnits ?? Prisma.DbNull,
                enumValues: data.enumValues ?? Prisma.DbNull,
              }
            : { archived: true }),
          revision: { increment: 1 },
        },
      });
      if (!result.count)
        throw new SpecificationError(
          'Характеристика изменена или в архиве. Обновите каталог.',
          409,
        );
      return mapDefinition(
        await tx.catalogAttributeDefinition.findUniqueOrThrow({ where: { id } }),
      );
    }
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
        await requireKindCompatibleWithRelations(tx, id, current.kind, data.kind);
      }
      const vendor = await tx.$queryRaw<
        Array<{ archived: boolean }>
      >`SELECT archived FROM "CatalogVendor" WHERE id = ${data.vendorId} FOR UPDATE`;
      if (!vendor.length || vendor[0].archived)
        throw new SpecificationError('Выберите действующего вендора', 409);
      await requireValidAttributes(tx, data.attributes);
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
      return {
        ...offer,
        unitPrice: offer.unitPrice?.toString() ?? null,
        taxRate: offer.taxRate?.toString() ?? null,
      };
    }
    if (d.action === 'offer.confirm') {
      // Only manual offers: GPL offers are confirmed by the explicit import confirmation.
      // Lock order Product → Vendor as in every other existing-product write.
      const offerId = text(d.offerId, 'Предложение', 100, true);
      const product = await lockProduct(tx, id);
      const vendors = await tx.$queryRaw<
        Array<{ archived: boolean }>
      >`SELECT archived FROM "CatalogVendor" WHERE id = ${product.vendorId} FOR UPDATE`;
      if (product.archived || !vendors.length || vendors[0].archived)
        throw new SpecificationError('Позиция или вендор архивированы', 409);
      const result = await tx.catalogOffer.updateMany({
        where: {
          id: offerId,
          productId: id,
          confirmationStatus: 'unconfirmed',
          importProvenance: { equals: Prisma.DbNull },
        },
        data: { confirmationStatus: 'confirmed', confirmedBy: actorId, confirmedAt: new Date() },
      });
      if (!result.count)
        throw new SpecificationError(
          'Предложение не найдено, уже подтверждено или получено из GPL (подтверждается импортом)',
          409,
        );
      const offer = await tx.catalogOffer.findUniqueOrThrow({ where: { id: offerId } });
      return {
        ...offer,
        unitPrice: offer.unitPrice?.toString() ?? null,
        taxRate: offer.taxRate?.toString() ?? null,
      };
    }
    throw new SpecificationError('Неизвестное действие каталога');
  };
  return db ? run(db) : prisma.$transaction(run);
}

/** Serialized by an advisory lock so concurrent writes cannot close a cycle together. */
async function createRelation(tx: Prisma.TransactionClient, input: unknown, actorId: string) {
  const data = relationInput(input);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog-product-relations'))`;
  const ids = [data.fromProductId, data.toProductId].sort();
  const products = await tx.$queryRaw<Array<{ id: string; archived: boolean; kind: string }>>`
    SELECT id, archived, kind FROM "CatalogProduct" WHERE id IN (${ids[0]}, ${ids[1]})
    ORDER BY id FOR SHARE
  `;
  const from = products.find((p) => p.id === data.fromProductId);
  const to = products.find((p) => p.id === data.toProductId);
  if (!from || !to) throw new SpecificationError('Позиция связи не найдена', 404);
  // A replaced (old) product may already be archived; the replacement must be active.
  if (from.archived || (data.type !== 'replaces' && to.archived))
    throw new SpecificationError('Связь создается для действующих позиций', 409);
  if (data.type === 'bundleComponent' && (from.kind !== 'bundle' || to.kind === 'bundle'))
    throw new SpecificationError(
      'Компоненты задаются для позиции типа «Комплект»; вложенные комплекты не поддерживаются',
    );
  const active = await tx.catalogProductRelation.findMany({
    where: { archivedAt: null, type: data.type },
    select: { fromProductId: true, toProductId: true, type: true },
  });
  checkRelation(active as Parameters<typeof checkRelation>[0], data);
  return mapRelation(
    await tx.catalogProductRelation.create({ data: { ...data, createdBy: actorId } }),
  );
}
