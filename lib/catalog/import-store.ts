import { createHash } from 'node:crypto';
import { prisma } from '../prisma';
import { SpecificationError } from '../specification/validation';
import { object, text, revision, productInput, offerInput } from './validation';
import { analyzeImport, importProfile } from './import-parser';
import { analyzeWithSavedProfile, type Analysis } from './import-profile-analysis';
import { technicalDiff } from './import-values';
import type { ImportDraft, ImportRow } from './import-types';
import type { Prisma } from '../generated/prisma/client';
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
export async function listImports(cursor?: string) {
  if (cursor !== undefined) {
    cursor = text(cursor, 'Курсор списка GPL', 100, true);
    const source = await prisma.catalogImport.findUnique({
      where: { id: cursor },
      select: { id: true },
    });
    if (!source) throw new SpecificationError('Пакет списка GPL не найден', 404);
  }
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
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
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
  const d = object(input);
  // A saved profile is resolved against this file's headers; otherwise the explicit mapping is used.
  const data: Analysis =
    d.savedProfileId !== undefined
      ? await analyzeWithSavedProfile(
          bytes,
          filename,
          d,
          d.vendorId === undefined ? undefined : text(d.vendorId, 'Вендор', 100, true),
        )
      : analyzeImport(bytes, filename, importProfile(input));
  const profile = data.profile;
  await matchDiagnostics(data);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  let reopened = false;
  const batch = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CatalogVendor" WHERE id = ${profile.vendorId} FOR UPDATE`;
    const vendor = await tx.catalogVendor.findUnique({ where: { id: profile.vendorId } });
    if (!vendor || vendor.archived)
      throw new SpecificationError('Выберите действующего вендора', 409);
    reopened = !!(await tx.catalogImport.findUnique({
      where: { vendorId_checksum: { vendorId: profile.vendorId, checksum } },
      select: { id: true },
    }));
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
  const draft = await loadImport(batch.id);
  // The same file reopens its saved package unchanged; say so instead of implying a new analysis.
  if (reopened)
    draft.notice =
      d.savedProfileId !== undefined
        ? 'Этот файл уже загружен: открыт сохраненный пакет, выбранный профиль к нему не применен. Примените профиль кнопкой «Применить профиль к этому файлу».'
        : 'Этот файл уже загружен: открыт сохраненный пакет с его настройками.';
  return draft;
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
        if (d.savedProfileId !== undefined) {
          data = await analyzeWithSavedProfile(batch.file, batch.filename, d, batch.vendorId, tx);
        } else {
          const profile = importProfile(d.profile);
          if (profile.vendorId !== batch.vendorId)
            throw new SpecificationError('Вендор импорта неизменяем');
          data = analyzeImport(batch.file, batch.filename, profile);
        }
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
        const accept = d.acceptTechnicalChanges ?? [];
        if (!Array.isArray(accept) || accept.some((v) => typeof v !== 'string' || !ids.has(v)))
          throw new SpecificationError(
            'Принять технические изменения можно только для выбранных строк',
          );
        const acceptedChanges = new Set(accept as string[]);
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
          if (product && technicalDiff(productInput(product), technical).length) {
            // A differing technical identity is a reviewed change: a new product
            // revision (old offers and project copies keep their snapshots).
            if (!acceptedChanges.has(row.id))
              throw new SpecificationError(
                `Строка ${row.rowNumber}: технические данные ${technical.sku} отличаются от каталога. Проверьте изменения и примите их явно.`,
                409,
              );
            if (
              row.technicalChange?.productId !== product.id ||
              row.technicalChange.productRevision !== product.revision
            )
              throw new SpecificationError(
                `Строка ${row.rowNumber}: позиция каталога изменилась после проверки. Примените настройки и проверьте строки заново.`,
                409,
              );
            const updated = await tx.catalogProduct.updateMany({
              where: { id: product.id, revision: product.revision, archived: false },
              data: {
                ...technical,
                attributes: json(technical.attributes),
                revision: { increment: 1 },
              },
            });
            if (!updated.count)
              throw new SpecificationError('Позиция изменена. Повторите подтверждение.', 409);
            product = await tx.catalogProduct.findUniqueOrThrow({ where: { id: product.id } });
          }
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
              // The explicit GPL confirmation is the confirmation of these offers.
              confirmationStatus: 'confirmed',
              confirmedBy: actorId,
              confirmedAt: new Date(),
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
    row.technicalChange = null;
    if (!row.normalized || row.errors.length) continue;
    const technical = row.normalized.product;
    const matches = products.filter(
      (p) => p.sku === technical.sku && p.edition === technical.edition,
    );
    if (matches.length > 1 || matches.some((p) => p.archived))
      row.errors.push(
        'Неоднозначный или архивный артикул/редакция. Укажите новый артикул или редакцию.',
      );
    else if (matches[0]) {
      const changes = technicalDiff(productInput(matches[0]), technical);
      row.technicalChange = changes.length
        ? { productId: matches[0].id, productRevision: matches[0].revision, changes }
        : null;
    }
    if (row.errors.length) row.status = 'error';
  }
}
