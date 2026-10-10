import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { loadCatalog, mutateCatalog } from '../lib/catalog/store';
import { catalogItem } from '../lib/catalog/snapshot';
import { saveSpecification, loadSpecification } from '../lib/specification/store';
import type { Product } from '../lib/catalog/types';
// Force the original deadlock schedule: hold Vendor; queue product.update;
// queue offer.create; release Vendor. The old code took Vendor → Product for
// the update, while the offer already owned Product and waited for Vendor.
async function verifyMixedConcurrency(product: Product, offer: unknown, actor: string) {
  let locked!: () => void;
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CatalogVendor" WHERE id = ${product.vendorId} FOR UPDATE`;
      locked();
      await gate;
    },
    { timeout: 15000 },
  );
  const waitForLocks = async (count: number) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%"Catalog%' AND pid <> pg_backend_pid()
      `;
      if (Number(rows[0].n) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected catalog lock contention was not observed');
  };
  const settle = (p: Promise<unknown>) =>
    p.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
  let update: ReturnType<typeof settle> | undefined;
  let price: ReturnType<typeof settle> | undefined;
  try {
    await acquired;
    update = settle(
      mutateCatalog(
        {
          action: 'product.update',
          id: product.id,
          revision: product.revision,
          product: { ...product, name: 'Mixed-write revision' },
        },
        actor,
      ),
    );
    await waitForLocks(1);
    price = settle(
      mutateCatalog(
        { action: 'offer.create', id: product.id, revision: product.revision, offer },
        actor,
      ),
    );
    await waitForLocks(2);
  } finally {
    release();
    await holder;
  }
  const [updated, priced] = await Promise.all([update!, price!]);
  assert(updated.ok, 'product update must commit without deadlock');
  assert(
    !priced.ok && priced.error.statusCode === 409,
    'queued offer must see the new revision and return 409, not database error',
  );
}
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
    await mutateCatalog(
      { action: 'vendor.update', id: vendor.id, revision: 1, name: `${actor}-renamed` },
      actor,
    );
    const originalTechnical = price.productSnapshot;
    assert(originalTechnical);
    assert.equal(originalTechnical.sku, 'SAME');
    assert.equal(originalTechnical.vendor.name, actor);
    const races = await Promise.allSettled([
      mutateCatalog(
        {
          action: 'product.update',
          id: created.id,
          revision: 1,
          product: {
            ...input,
            vendorId: vendor2.id,
            sku: 'NEW',
            name: 'Новая позиция',
            edition: 'Edition B',
            attributes: [{ name: 'EPS', value: '4000', unit: 'событий/с' }],
          },
        },
        actor,
      ),
      mutateCatalog(
        {
          action: 'product.update',
          id: created.id,
          revision: 1,
          product: {
            ...input,
            vendorId: vendor2.id,
            sku: 'NEW',
            name: 'Новая позиция',
            edition: 'Edition B',
            attributes: [{ name: 'EPS', value: '4000', unit: 'событий/с' }],
          },
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
    assert.deepEqual(
      updated.offers.find((o) => o.id === price.id)?.productSnapshot,
      originalTechnical,
      'original vendor/SKU/edition/attributes retained without a project reference',
    );
    await verifyMixedConcurrency(updated as unknown as Product, offer, actor);

    assert.throws(() => catalogItem(updated as unknown as Product, price), /предыдущей редакции/);
    await mutateCatalog({ action: 'vendor.archive', id: vendor.id, revision: 2 }, actor);
    await assert.rejects(mutateCatalog({ action: 'product.create', product: input }, actor));
    await mutateCatalog({ action: 'vendor.archive', id: vendor2.id, revision: 1 }, actor);
    await assert.rejects(
      mutateCatalog({ action: 'offer.create', id: created.id, revision: 3, offer }, actor),
    );
    assert.deepEqual(
      (await loadSpecification(calculation.id, 1))?.snapshot,
      saved.snapshot,
      'released snapshot survives catalogue changes and archival',
    );
    console.log(
      'Catalog PostgreSQL passed: distinct SKU identities, decimal/null/zero, immutable technical history, mixed-operation lock contention without deadlock, retained offers, stale 409, archive gate, immutable released project.',
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
