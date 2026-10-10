import { createHash } from 'node:crypto';
import { prisma } from '../prisma';
import { SpecificationError } from '../specification/validation';
import { object, text, revision, productInput, offerInput } from './validation';
import { analyzeImport, importProfile } from './import-parser';
import type { ImportDraft, ImportRow } from './import-types';
import type { Prisma } from '../generated/prisma/client';
type Analysis = ReturnType<typeof analyzeImport>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function loadImport(id: string, historicalRevision?: number): Promise<ImportDraft> {
  const batch = await prisma.catalogImport.findUnique({
    where: { id },
    omit: { file: true },
    include: {
      revisions: {
        ...(historicalRevision === undefined ? {} : { where: { revision: historicalRevision } }),
        orderBy: { revision: 'desc' },
        take: 1,
      },
    },
  });
  if (!batch) throw new SpecificationError('Импорт не найден', 404);
  if (!batch.revisions.length) throw new SpecificationError('Редакция импорта не найдена', 404);
  const saved = batch.revisions[0];
  const data = saved.data as unknown as Analysis;
  return {
    id: batch.id,
    revision: saved.revision,
    revisionCreatedBy: saved.createdBy,
    revisionCreatedAt: saved.createdAt.toISOString(),
    status:
      historicalRevision === undefined
        ? (batch.status as ImportDraft['status'])
        : data.rows.some((r) => r.status === 'accepted')
          ? 'confirmed'
          : 'draft',
    filename: batch.filename,
    checksum: batch.checksum,
    createdBy: batch.createdBy,
    createdAt: batch.createdAt.toISOString(),
    confirmedBy: data.rows.some((r) => r.status === 'accepted') ? batch.confirmedBy : null,
    confirmedAt: data.rows.some((r) => r.status === 'accepted')
      ? (batch.confirmedAt?.toISOString() ?? null)
      : null,
    ...data,
  };
}
export async function listImports() {
  return prisma.catalogImport.findMany({
    select: {
      id: true,
      filename: true,
      vendorId: true,
      revision: true,
      status: true,
      checksum: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
export async function createImport(
  bytes: Uint8Array,
  filename: string,
  input: unknown,
  actorId: string,
) {
  filename = text(filename.replace(/^.*[\\/]/, ''), 'Имя файла', 200, true);
  const profile = importProfile(input),
    data = analyzeImport(bytes, filename, profile);
  await matchDiagnostics(data);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const batch = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CatalogVendor" WHERE id = ${profile.vendorId} FOR UPDATE`;
    const vendor = await tx.catalogVendor.findUnique({ where: { id: profile.vendorId } });
    if (!vendor || vendor.archived)
      throw new SpecificationError('Выберите действующего вендора', 409);
    // The unique identity also serializes concurrent retry uploads.
    return tx.catalogImport.upsert({
      where: { vendorId_checksum: { vendorId: profile.vendorId, checksum } },
      update: {},
      create: {
        vendorId: profile.vendorId,
        checksum,
        filename,
        file: new Uint8Array(bytes),
        createdBy: actorId,
        revisions: { create: { revision: 1, data: json(data), createdBy: actorId } },
      },
    });
  });
  return loadImport(batch.id);
}
export async function importAttachment(id: string) {
  const batch = await prisma.catalogImport.findUnique({
    where: { id },
    select: { file: true, filename: true, checksum: true },
  });
  if (!batch) throw new SpecificationError('Импорт не найден', 404);
  return batch;
}
export async function mutateImport(id: string, input: unknown, actorId: string) {
  const d = object(input),
    expected = revision(d.revision);
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CatalogImport" WHERE id = ${id} FOR UPDATE`;
      const batch = await tx.catalogImport.findUnique({
        where: { id },
        include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
      });
      if (!batch) throw new SpecificationError('Импорт не найден', 404);
      if (batch.revision !== expected || batch.status !== 'draft')
        throw new SpecificationError('Импорт уже изменен или подтвержден. Обновите страницу.', 409);
      let data = batch.revisions[0].data as unknown as Analysis;
      if (d.action === 'analyze') {
        const profile = importProfile(d.profile);
        if (profile.vendorId !== batch.vendorId)
          throw new SpecificationError('Вендор импорта неизменяем');
        data = analyzeImport(batch.file, batch.filename, profile);
      } else if (d.action === 'correct') {
        const rowId = text(d.rowId, 'Строка', 300, true),
          normalized = object(d.normalized);
        const product = productInput(normalized.product),
          offer = offerInput(normalized.offer);
        if (product.vendorId !== batch.vendorId || !product.sku)
          throw new SpecificationError('Вендор и артикул обязательны');
        if (!data.rows.some((r) => r.id === rowId))
          throw new SpecificationError('Строка не найдена', 404);
        data = {
          ...data,
          rows: data.rows.map((r) =>
            r.id === rowId
              ? { ...r, normalized: { product, offer }, errors: [], status: 'ready' }
              : r,
          ),
        };
      } else if (d.action === 'confirm') {
        if (
          !Array.isArray(d.rowIds) ||
          !d.rowIds.length ||
          d.rowIds.length > 10000 ||
          d.rowIds.some((v) => typeof v !== 'string') ||
          new Set(d.rowIds).size !== d.rowIds.length
        )
          throw new SpecificationError('Выберите уникальные строки');
        const ids = new Set(d.rowIds as string[]),
          selected = data.rows.filter((r) => ids.has(r.id));
        if (selected.length !== ids.size || selected.some((r) => r.errors.length || !r.normalized))
          throw new SpecificationError('Выбраны ошибочные или неизвестные строки');
        if (
          new Set(
            selected.map((r) =>
              JSON.stringify([r.normalized!.product.sku, r.normalized!.product.edition]),
            ),
          ).size !== selected.length
        )
          throw new SpecificationError('Дублирующиеся артикулы: исправьте строки');
        // Lock existing products in deterministic order before Vendor, matching catalog writes.
        const candidates = await tx.catalogProduct.findMany({
          where: {
            vendorId: batch.vendorId,
            sku: { in: selected.map((r) => r.normalized!.product.sku) },
          },
          orderBy: { id: 'asc' },
        });
        const lockedProductIds = new Set(candidates.map((p) => p.id));
        for (const p of candidates)
          await tx.$queryRaw`SELECT id FROM "CatalogProduct" WHERE id = ${p.id} FOR UPDATE`;
        const vendors = await tx.$queryRaw<
          Array<{ id: string; name: string; revision: number; archived: boolean }>
        >`SELECT id,name,revision,archived FROM "CatalogVendor" WHERE id = ${batch.vendorId} FOR UPDATE`;
        const vendor = vendors[0];
        if (!vendor || vendor.archived) throw new SpecificationError('Вендор архивирован', 409);
        // Re-read after vendor lock to include concurrent creations; never overwrite technical identities.
        const products = await tx.catalogProduct.findMany({
          where: {
            vendorId: batch.vendorId,
            sku: { in: selected.map((r) => r.normalized!.product.sku) },
          },
        });
        for (const row of selected) {
          const technical = productInput(row.normalized!.product),
            offer = offerInput(row.normalized!.offer);
          const matches = products.filter(
            (p) => p.sku === technical.sku && p.edition === technical.edition,
          );
          if (matches.length > 1 || matches.some((p) => p.archived))
            throw new SpecificationError(
              `Неоднозначный или архивный артикул ${technical.sku}`,
              409,
            );
          let product = matches[0];
          // A creation or move into this vendor can appear after the initial
          // product query. Taking its lock now would invert Product → Vendor;
          // even inserting an offer needs a conflicting FK KEY SHARE lock.
          if (product && !lockedProductIds.has(product.id))
            throw new SpecificationError(
              'Каталог изменен во время подтверждения. Повторите подтверждение.',
              409,
            );
          if (product && JSON.stringify(productInput(product)) !== JSON.stringify(technical))
            throw new SpecificationError(
              `Технические данные ${technical.sku} отличаются. Исправьте строку или создайте новый артикул.`,
              409,
            );
          if (!product)
            product = await tx.catalogProduct.create({
              data: { ...technical, attributes: json(technical.attributes), createdBy: actorId },
            });
          await tx.catalogOffer.create({
            data: {
              ...offer,
              productId: product.id,
              productRevision: product.revision,
              productSnapshot: json({
                ...technical,
                id: product.id,
                revision: product.revision,
                vendor: { id: vendor.id, name: vendor.name, revision: vendor.revision },
              }),
              importProvenance: {
                importId: id,
                importRevision: expected,
                checksum: batch.checksum,
                filename: batch.filename,
                sheet: row.sheet,
                rowNumber: row.rowNumber,
                uploadedBy: batch.createdBy,
                confirmedBy: actorId,
              },
              createdBy: actorId,
            },
          });
        }
        data = {
          ...data,
          rows: data.rows.map((r) => ({
            ...r,
            status: ids.has(r.id) ? 'accepted' : r.errors.length ? 'error' : 'excluded',
          })) as ImportRow[],
        };
      } else throw new SpecificationError('Неизвестное действие импорта');
      if (d.action !== 'confirm') await matchDiagnostics(data, tx);
      await tx.catalogImportRevision.create({
        data: { importId: id, revision: expected + 1, data: json(data), createdBy: actorId },
      });
      await tx.catalogImport.update({
        where: { id },
        data: {
          revision: expected + 1,
          ...(d.action === 'confirm'
            ? { status: 'confirmed', confirmedBy: actorId, confirmedAt: new Date() }
            : {}),
        },
      });
    },
    { timeout: 30000 },
  );
  return loadImport(id);
}

async function matchDiagnostics(
  data: Analysis,
  db: Pick<Prisma.TransactionClient, 'catalogProduct'> = prisma,
) {
  const products = await db.catalogProduct.findMany({ where: { vendorId: data.profile.vendorId } });
  for (const row of data.rows) {
    if (!row.normalized || row.errors.length) continue;
    const technical = row.normalized.product;
    const matches = products.filter(
      (p) => p.sku === technical.sku && p.edition === technical.edition,
    );
    if (matches.length > 1 || matches.some((p) => p.archived))
      row.errors.push(
        'Неоднозначный или архивный артикул/редакция. Укажите новый артикул или редакцию.',
      );
    else if (matches[0] && JSON.stringify(productInput(matches[0])) !== JSON.stringify(technical))
      row.errors.push(
        'Технические данные существующей позиции отличаются. Исправьте значения или укажите новый артикул/редакцию.',
      );
    if (row.errors.length) row.status = 'error';
  }
}
