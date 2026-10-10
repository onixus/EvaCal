import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { loadCatalog, mutateCatalog } from '../lib/catalog/store';
import { catalogItem } from '../lib/catalog/snapshot';
import { saveSpecification, loadSpecification } from '../lib/specification/store';
import type { Product } from '../lib/catalog/types';
async function main() {
  const actor = `ci-catalog-${Date.now()}`;
  const template = await prisma.formTemplate.create({ data: { name: actor } });
  try {
    const vendor = await mutateCatalog({ action: 'vendor.create', name: actor }, actor);
    const vendor2 = await mutateCatalog({ action: 'vendor.create', name: `${actor}-other` }, actor);
    const input = {
      vendorId: vendor.id,
      name: 'ПО',
      sku: 'SAME',
      edition: 'Edition A',
      kind: 'software',
      unit: 'узел',
      licensing: 'По узлам',
      attributes: [{ name: 'EPS', value: '2000', unit: 'событий/с' }],
    };
    const created = await mutateCatalog({ action: 'product.create', product: input }, actor);
    const other = await mutateCatalog(
      { action: 'product.create', product: { ...input, vendorId: vendor2.id } },
      actor,
    );
    assert.notEqual(created.id, other.id, 'SKU is not globally unique');
    const offer = {
      source: 'Ручной прайс',
      unitPrice: '123.000001',
      currency: 'USD',
      region: 'TR',
      terms: '12 месяцев',
      priceDate: null,
      validUntil: null,
    };
    await mutateCatalog({ action: 'offer.create', id: created.id, revision: 1, offer }, actor);
    await mutateCatalog(
      { action: 'offer.create', id: created.id, revision: 1, offer: { ...offer, unitPrice: null } },
      actor,
    );
    await mutateCatalog(
      { action: 'offer.create', id: created.id, revision: 1, offer: { ...offer, unitPrice: '0' } },
      actor,
    );
    let catalog = await loadCatalog();
    const product = JSON.parse(
      JSON.stringify(catalog.products.find((p) => p.id === created.id)),
    ) as Product;
    assert.equal(product.offers.length, 3);
    assert(product.offers.some((o) => o.unitPrice === null));
    assert(product.offers.some((o) => o.unitPrice === '0'));
    const price = product.offers.find((o) => o.unitPrice === '123.000001')!;
    const item = {
      ...catalogItem(product, price, 'row1'),
      quantity: '2',
      rationale: 'Подтвержденная потребность',
      confirmed: true,
    };
    const calculation = await prisma.calculation.create({
      data: { templateId: template.id, name: actor, customer: 'CI', answers: '{}' },
    });
    const saved = await saveSpecification(
      calculation.id,
      { version: 0, status: 'confirmed', emptySupplyReason: '', items: [item] },
      actor,
    );
    const races = await Promise.allSettled([
      mutateCatalog(
        {
          action: 'product.update',
          id: created.id,
          revision: 1,
          product: { ...input, sku: 'NEW', name: 'Новая позиция' },
        },
        actor,
      ),
      mutateCatalog(
        {
          action: 'product.update',
          id: created.id,
          revision: 1,
          product: { ...input, sku: 'NEW', name: 'Новая позиция' },
        },
        actor,
      ),
    ]);
    assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = races.find((r) => r.status === 'rejected');
    assert(rejected?.status === 'rejected' && rejected.reason.statusCode === 409);
    await assert.rejects(
      mutateCatalog({ action: 'offer.create', id: created.id, revision: 1, offer }, actor),
      (e) => (e as { statusCode: number }).statusCode === 409,
    );
    catalog = await loadCatalog();
    const updated = catalog.products.find((p) => p.id === created.id)!;
    assert.equal(updated.offers.length, 3, 'old offers retained');
    assert.throws(() => catalogItem(updated as unknown as Product, price), /предыдущей редакции/);
    await mutateCatalog({ action: 'vendor.archive', id: vendor.id, revision: 1 }, actor);
    await assert.rejects(mutateCatalog({ action: 'product.create', product: input }, actor));
    await assert.rejects(
      mutateCatalog({ action: 'offer.create', id: created.id, revision: 2, offer }, actor),
    );
    assert.deepEqual(
      (await loadSpecification(calculation.id, 1))?.snapshot,
      saved.snapshot,
      'released snapshot survives catalogue changes and archival',
    );
    console.log(
      'Catalog PostgreSQL passed: distinct SKU identities, decimal/null/zero, retained offers, stale 409, archive gate, immutable released project.',
    );
  } finally {
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
    await prisma.catalogOffer.deleteMany({ where: { createdBy: actor } });
    await prisma.catalogProduct.deleteMany({ where: { createdBy: actor } });
    await prisma.catalogVendor.deleteMany({ where: { createdBy: actor } });
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
