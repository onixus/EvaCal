import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { createImport, mutateImport, loadImport, listImports } from '../lib/catalog/import-store';
import { compareImports } from '../lib/catalog/import-comparison';
import { mutateCatalog, loadCatalog } from '../lib/catalog/store';
import { catalogItem } from '../lib/catalog/snapshot';
import { loadSpecification, saveSpecification } from '../lib/specification/store';
import type { Product } from '../lib/catalog/types';

async function main() {
  const actor = `ci-gpl-comparison-${Date.now()}`;
  let templateId: string | undefined;
  try {
    const vendor = await mutateCatalog({ action: 'vendor.create', name: actor }, actor);
    const profile = {
      vendorId: vendor.id,
      mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3, currency: 4, terms: 5 },
      delimiter: ';',
      decimalSeparator: '.',
    };
    const beforeDraft = await createImport(
      Buffer.from(
        'Name;SKU;Unit;Price;Currency;Terms\nStable;ST;шт;1.000000;RUB;\nPrice;P;шт;123456789012.123456;USD;\nUnknown;U;шт;;RUB;\nRemoved;R;шт;2;RUB;\nConfig;T;шт;3;RUB;\nExcluded;X;шт;9;RUB;',
      ),
      'before.csv',
      profile,
      actor,
    );
    const before = await mutateImport(
      beforeDraft.id,
      { action: 'confirm', revision: 1, rowIds: beforeDraft.rows.slice(0, 5).map((r) => r.id) },
      actor,
    );
    const catalog = await loadCatalog();
    const product = catalog.products.find((p) => p.vendorId === vendor.id && p.sku === 'P')!;
    const productSnapshot = JSON.parse(JSON.stringify(product)) as Product;
    const projectItem = catalogItem(productSnapshot, productSnapshot.offers[0]);
    const template = await prisma.formTemplate.create({ data: { name: actor } });
    templateId = template.id;
    const calculation = await prisma.calculation.create({
      data: { templateId, name: actor, customer: 'CI', answers: '{}' },
    });
    const specification = await saveSpecification(
      calculation.id,
      {
        version: 0,
        status: 'draft',
        emptySupplyReason: '',
        items: [
          { ...projectItem, quantity: '2' },
          { ...projectItem, id: 'manual', name: 'Manual', source: 'Manual price', unitPrice: '50' },
        ],
      },
      actor,
    );
    const technical = catalog.products.find((p) => p.vendorId === vendor.id && p.sku === 'T')!;
    await mutateCatalog(
      {
        action: 'product.update',
        id: technical.id,
        revision: technical.revision,
        product: { ...technical, name: 'Config revised' },
      },
      actor,
    );
    const afterDraft = await createImport(
      Buffer.from(
        'Name;SKU;Unit;Price;Currency;Terms\nStable;ST;шт;1;RUB;\nPrice;P;шт;123456789012.123457;EUR;Annual\nUnknown;U;шт;0;RUB;\nConfig revised;T;шт;3;RUB;\nAdded;N;шт;5;RUB;\nRemoved;R;шт;2;RUB;\nBad;BAD;шт;oops;RUB;',
      ),
      'after.csv',
      profile,
      actor,
    );
    await assert.rejects(compareImports(before.id, afterDraft.id), { statusCode: 409 });
    const after = await mutateImport(
      afterDraft.id,
      { action: 'confirm', revision: 1, rowIds: afterDraft.rows.slice(0, 5).map((r) => r.id) },
      actor,
    );
    const comparison = await compareImports(before.id, after.id);
    assert.deepEqual(comparison.counts, {
      added: 1,
      missing: 1,
      changed: 3,
      unchanged: 1,
      ambiguous: 0,
    });
    const changes = comparison.rows.find((r) => r.sku === 'P')!.changes;
    assert(changes.some((c) => c.field === 'unitPrice' && c.after === '123456789012.123457'));
    assert(changes.some((c) => c.field === 'currency' && c.after === 'EUR'));
    assert(changes.some((c) => c.field === 'terms' && c.after === 'Annual'));
    assert(comparison.rows.find((r) => r.sku === 'T')!.changes.some((c) => c.field === 'name'));
    assert(
      comparison.rows
        .find((r) => r.sku === 'U')!
        .changes.some((c) => c.before === null && c.after === '0'),
    );
    assert.equal(comparison.after.excludedCount, 1);
    assert.equal(comparison.after.errorCount, 1);
    assert(comparison.warnings.length > 0);
    assert(!comparison.rows.some((r) => r.sku === 'X' || r.sku === 'BAD'));
    const savedBeforeComparison = JSON.stringify(comparison);
    const stable = catalog.products.find((p) => p.vendorId === vendor.id && p.sku === 'ST')!;
    await mutateCatalog(
      { action: 'product.archive', id: stable.id, revision: stable.revision },
      actor,
    );
    await mutateCatalog(
      { action: 'vendor.update', id: vendor.id, revision: 1, name: `${actor}-renamed` },
      actor,
    );
    assert.equal(JSON.stringify(await compareImports(before.id, after.id)), savedBeforeComparison);
    assert.deepEqual((await loadImport(before.id)).rows, before.rows);
    assert.deepEqual(await loadSpecification(calculation.id), specification);
    const olderSources = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        createImport(
          Buffer.from(`Name;SKU;Unit;Price;Currency;Terms\nPagination;PAGE-${index};шт;1;RUB;`),
          `page-${index}.csv`,
          profile,
          actor,
        ),
      ),
    );
    const firstPage = await listImports();
    assert.equal(firstPage.length, 100);
    const secondPage = await listImports(firstPage[firstPage.length - 1].id);
    const allIds = [...firstPage, ...secondPage].map((entry) => entry.id);
    assert.equal(new Set(allIds).size, allIds.length, 'history pages must not overlap');
    for (const id of [before.id, after.id, ...olderSources.map((entry) => entry.id)])
      assert(allIds.includes(id), 'older GPL remain reachable beyond the first 100 entries');
    console.log(
      'GPL comparison PostgreSQL passed: exact decimals, added/missing/changed/unchanged, technical and commercial changes, accepted scope, draft refusal, immutable sources and mixed project prices after catalog edits, paged history beyond 100 imports.',
    );
  } finally {
    if (templateId) {
      await prisma.calculation.deleteMany({ where: { templateId } });
      await prisma.formTemplate.delete({ where: { id: templateId } });
    }
    await prisma.catalogOffer.deleteMany({ where: { createdBy: actor } });
    await prisma.catalogProduct.deleteMany({ where: { createdBy: actor } });
    const batches = await prisma.catalogImport.findMany({
      where: { createdBy: actor },
      select: { id: true },
    });
    await prisma.catalogImportRevision.deleteMany({
      where: { importId: { in: batches.map((b) => b.id) } },
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
