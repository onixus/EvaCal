import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { createImport, mutateImport } from '../lib/catalog/import-store';
import { loadCatalog, mutateCatalog } from '../lib/catalog/store';
import { catalogItem } from '../lib/catalog/snapshot';
import { loadSpecification, saveSpecification } from '../lib/specification/store';
import { previewGplUpdate, applyGplUpdate } from '../lib/specification/gpl-updates';
import type { GplUpdateRequest } from '../lib/specification/gpl-update-types';
import type { Product } from '../lib/catalog/types';
import type { SpecificationItem } from '../lib/specification/types';

async function main() {
  const actor = `ci-gpl-updates-${Date.now()}`;
  let templateId: string | undefined;
  try {
    const vendor = await mutateCatalog({ action: 'vendor.create', name: actor }, actor);
    const profile = {
      vendorId: vendor.id,
      mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3, currency: 4, terms: 5 },
      delimiter: ';',
      decimalSeparator: '.',
    };
    async function upload(filename: string, csv: string) {
      const draft = await createImport(Buffer.from(csv), filename, profile, actor);
      return mutateImport(
        draft.id,
        {
          action: 'confirm',
          revision: draft.revision,
          rowIds: draft.rows.filter((row) => row.status === 'ready').map((row) => row.id),
        },
        actor,
      );
    }
    const before = await upload(
      'before.csv',
      'Name;SKU;Unit;Price;Currency;Terms\nExact;A;шт;123456789012.123456;USD;Old\nManual price;B;шт;10;RUB;Old\nRemoved;R;шт;2;RUB;Old\nUnknown;U;шт;;RUB;Old\nFree;F;шт;0;RUB;Old\n',
    );
    const catalog = await loadCatalog();
    const copied = (sku: string, id: string) => {
      const product = catalog.products.find(
        (p) => p.vendorId === vendor.id && p.sku === sku,
      )! as unknown as Product;
      return {
        ...catalogItem(product, product.offers[0], id),
        quantity: '2',
        rationale: 'Project decision',
        confirmed: true,
      };
    };
    const manual: SpecificationItem = {
      id: 'manual',
      kind: 'service',
      disposition: 'supply',
      name: 'Manual service',
      vendor: '',
      sku: 'A',
      quantity: '3',
      unit: 'час',
      configuration: '',
      licensing: '',
      term: '',
      source: 'Manual',
      rationale: 'Project decision',
      confirmed: true,
      unitPrice: '50',
      currency: 'RUB',
    };
    const template = await prisma.formTemplate.create({ data: { name: actor } });
    templateId = template.id;
    const calculation = await prisma.calculation.create({
      data: { templateId, name: actor, customer: 'CI', answers: '{}' },
    });
    const initial = await saveSpecification(
      calculation.id,
      {
        version: 0,
        status: 'confirmed',
        emptySupplyReason: '',
        items: [
          copied('A', 'exact'),
          { ...copied('B', 'override'), unitPrice: '7', priceOverride: true },
          copied('R', 'removed'),
          copied('U', 'unknown'),
          copied('F', 'free'),
          manual,
        ],
      },
      actor,
    );
    const forged = structuredClone(initial.snapshot);
    forged.items[0].origin!.baseline.unitPrice = '1';
    await assert.rejects(saveSpecification(calculation.id, { ...forged, status: 'draft' }, actor), {
      statusCode: 409,
    });
    const removedOrigin = structuredClone(initial.snapshot);
    delete removedOrigin.items[0].origin;
    await assert.rejects(
      saveSpecification(calculation.id, { ...removedOrigin, status: 'draft' }, actor),
      { statusCode: 409 },
    );
    const guestCalculation = await prisma.calculation.create({
      data: {
        templateId,
        name: `${actor}-guest`,
        customer: 'CI',
        answers: '{}',
      },
    });
    await assert.rejects(
      saveSpecification(
        guestCalculation.id,
        {
          ...initial.snapshot,
          version: 0,
          status: 'draft',
        },
        'share:guest',
        { allowNewCatalogOrigins: false },
      ),
      { statusCode: 403 },
    );
    const sharedClone = await saveSpecification(
      guestCalculation.id,
      {
        ...initial.snapshot,
        version: 0,
        status: 'draft',
        items: [initial.snapshot.items[0]],
      },
      actor,
    );
    const copiedByShare = await saveSpecification(
      guestCalculation.id,
      {
        ...sharedClone.snapshot,
        items: [
          ...sharedClone.snapshot.items,
          { ...sharedClone.snapshot.items[0], id: 'share-copy' },
        ],
      },
      'share:guest',
      { allowNewCatalogOrigins: false },
    );
    assert.equal(
      copiedByShare.snapshot.items.length,
      2,
      'write-share can clone its existing project row without catalog lookup',
    );
    const markedManual = await saveSpecification(
      guestCalculation.id,
      {
        ...copiedByShare.snapshot,
        items: copiedByShare.snapshot.items.map((item, index) =>
          index === 0 ? { ...item, priceOverride: true } : item,
        ),
      },
      actor,
    );
    const retainedManual = await saveSpecification(
      guestCalculation.id,
      {
        ...markedManual.snapshot,
        items: markedManual.snapshot.items.map((item, index) =>
          index === 0 ? { ...item, priceOverride: false } : item,
        ),
      },
      actor,
    );
    assert.equal(
      retainedManual.snapshot.items[0].priceOverride,
      true,
      'ordinary saves cannot drop an existing manual price decision',
    );
    const clonedManual = await saveSpecification(
      guestCalculation.id,
      {
        ...retainedManual.snapshot,
        items: [
          ...retainedManual.snapshot.items,
          { ...retainedManual.snapshot.items[0], id: 'copy-manual-flag', priceOverride: false },
        ],
      },
      actor,
      { allowNewCatalogOrigins: false },
    );
    assert.equal(
      clonedManual.snapshot.items.find((item) => item.id === 'copy-manual-flag')!.priceOverride,
      true,
      'changing a copied row ID cannot erase manual-price consent',
    );
    const after = await upload(
      'after.csv',
      'Name;SKU;Unit;Price;Currency;Terms\nExact;A;шт;123456789012.123457;EUR;Annual\nManual price;B;шт;20;RUB;Annual\nUnknown;U;шт;0;RUB;Annual\nFree;F;шт;;RUB;Annual\nAdded;NEW;шт;1;RUB;Annual\n',
    );
    const preview = await previewGplUpdate(calculation.id, after.id);
    assert.equal(preview.version, initial.snapshot.version);
    assert.equal(preview.rows.find((row) => row.itemId === 'manual')!.status, 'unlinked');
    assert.equal(preview.rows.find((row) => row.itemId === 'removed')!.status, 'missing');
    assert.equal(preview.rows.find((row) => row.itemId === 'override')!.manualPrice, true);
    assert(
      !preview.selections.find((row) => row.itemId === 'override')?.fields.includes('unitPrice'),
    );
    assert(
      preview.rows
        .find((row) => row.itemId === 'exact')!
        .changes.some(
          (change) => change.field === 'unitPrice' && change.after === '123456789012.123457',
        ),
    );
    assert.deepEqual(await loadSpecification(calculation.id), initial, 'preview cannot write');
    const request: GplUpdateRequest = {
      action: 'apply',
      version: preview.version,
      targetImportId: after.id,
      targetRevision: preview.target.revision,
      targetChecksum: preview.target.checksum,
      selections: [
        { itemId: 'exact', fields: ['unitPrice', 'currency', 'term'] },
        { itemId: 'override', fields: ['term'] },
        { itemId: 'unknown', fields: ['unitPrice', 'currency', 'term'] },
      ],
    };
    const selectedPreview = await previewGplUpdate(calculation.id, after.id, request.selections, {
      version: request.version,
      targetRevision: request.targetRevision,
      targetChecksum: request.targetChecksum,
    });
    assert.equal(
      selectedPreview.totals.after.find((entry) => entry.currency === 'EUR')!.total,
      '246913578024.246914',
    );
    const saved = await applyGplUpdate(calculation.id, request, actor);
    assert.equal(saved.snapshot.version, initial.snapshot.version + 1);
    assert.equal(saved.snapshot.status, 'draft');
    const exact = saved.snapshot.items.find((item) => item.id === 'exact')!;
    assert.equal(exact.unitPrice, '123456789012.123457');
    assert.equal(exact.currency, 'EUR');
    assert.equal(exact.term, 'Annual');
    assert.equal(exact.quantity, '2');
    assert.equal(exact.rationale, 'Project decision');
    assert.equal(exact.confirmed, false);
    assert.equal(saved.snapshot.items.find((item) => item.id === 'override')!.unitPrice, '7');
    assert.equal(saved.snapshot.items.find((item) => item.id === 'override')!.term, 'Annual');
    assert.equal(saved.snapshot.items.find((item) => item.id === 'unknown')!.unitPrice, '0');
    assert.deepEqual(
      saved.snapshot.items.find((item) => item.id === 'manual'),
      manual,
    );
    assert.deepEqual(
      saved.snapshot.items.find((item) => item.id === 'removed'),
      initial.snapshot.items.find((item) => item.id === 'removed'),
    );
    assert.equal(saved.snapshot.items.find((item) => item.id === 'free')!.unitPrice, '0');
    assert.deepEqual(await loadSpecification(calculation.id, initial.snapshot.version), initial);
    await assert.rejects(applyGplUpdate(calculation.id, request, actor), { statusCode: 409 });
    const next = await previewGplUpdate(calculation.id, after.id);
    assert(
      !next.rows.find((row) => row.itemId === 'exact')!.manualPrice,
      'applied field origin follows target source',
    );
    assert(
      next.rows.find((row) => row.itemId === 'override')!.manualPrice,
      'partial update keeps manual price',
    );
    const overrideRequest: GplUpdateRequest = {
      ...request,
      version: next.version,
      selections: [{ itemId: 'override', fields: ['unitPrice', 'currency'] }],
    };
    await assert.rejects(applyGplUpdate(calculation.id, overrideRequest, actor), {
      statusCode: 400,
    });
    const overridden = await applyGplUpdate(
      calculation.id,
      {
        ...overrideRequest,
        selections: [
          { itemId: 'override', fields: ['unitPrice', 'currency'], allowPriceOverride: true },
        ],
      },
      actor,
    );
    assert.equal(overridden.snapshot.items.find((item) => item.id === 'override')!.unitPrice, '20');
    assert.equal(
      overridden.snapshot.items.find((item) => item.id === 'override')!.priceOverride,
      false,
    );
    assert.deepEqual(await loadSpecification(calculation.id, initial.snapshot.version), initial);
    const product = catalog.products.find(
      (item) => item.vendorId === vendor.id && item.sku === 'A',
    )!;
    const beforeArchive = await previewGplUpdate(calculation.id, after.id);
    await mutateCatalog(
      { action: 'product.archive', id: product.id, revision: product.revision },
      actor,
    );
    assert.deepEqual((await previewGplUpdate(calculation.id, after.id)).rows, beforeArchive.rows);
    assert.equal(
      (await loadSpecification(calculation.id))!.snapshot.version,
      overridden.snapshot.version,
    );
    console.log(
      'GPL project updates PostgreSQL passed: verified confirmed source revisions, exact currency totals, selective new draft, preserved manual prices and rows, explicit override, partial field provenance, stale 409 and immutable historical version.',
    );
  } finally {
    if (templateId) {
      await prisma.calculation.deleteMany({ where: { templateId } });
      await prisma.formTemplate.delete({ where: { id: templateId } });
    }
    await prisma.catalogOffer.deleteMany({ where: { createdBy: actor } });
    await prisma.catalogProduct.deleteMany({ where: { createdBy: actor } });
    const imports = await prisma.catalogImport.findMany({
      where: { createdBy: actor },
      select: { id: true },
    });
    await prisma.catalogImportRevision.deleteMany({
      where: { importId: { in: imports.map((entry) => entry.id) } },
    });
    await prisma.catalogImport.deleteMany({ where: { createdBy: actor } });
    await prisma.catalogVendor.deleteMany({ where: { createdBy: actor } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
