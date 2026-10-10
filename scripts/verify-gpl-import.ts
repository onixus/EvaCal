import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { mutateCatalog } from '../lib/catalog/store';
import {
  createImport,
  mutateImport,
  loadImport,
  importAttachment,
} from '../lib/catalog/import-store';
async function main() {
  const actor = `ci-gpl-${Date.now()}`;
  try {
    const vendor = await mutateCatalog({ action: 'vendor.create', name: actor }, actor);
    const profile = {
      vendorId: vendor.id,
      mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3 },
      delimiter: ';',
      decimalSeparator: ',',
    };
    const bytes = Buffer.from(
      'name;sku;unit;price\nA;A;шт;10,000001\nB;B;шт;\nC;C;шт;0\nBad;D;;oops',
    );
    const [draft, duplicate] = await Promise.all([
      createImport(bytes, 'gpl.csv', profile, actor),
      createImport(bytes, 'gpl.csv', profile, actor),
    ]);
    assert.equal(draft.id, duplicate.id);
    assert.equal(draft.rows.length, 4);
    assert.equal(
      await prisma.catalogProduct.count({ where: { vendorId: vendor.id } }),
      0,
      'preview must not mutate catalog',
    );
    const attachment = await importAttachment(draft.id);
    assert.deepEqual(Buffer.from(attachment.file), bytes);
    assert.equal(attachment.checksum, createHash('sha256').update(bytes).digest('hex'));
    await assert.rejects(
      mutateImport(draft.id, { action: 'confirm', revision: 1, rowIds: [draft.rows[3].id] }, actor),
    );
    const confirmed = await mutateImport(
      draft.id,
      { action: 'confirm', revision: 1, rowIds: draft.rows.slice(0, 3).map((r) => r.id) },
      actor,
    );
    assert.equal(confirmed.status, 'confirmed');
    assert.equal((await loadImport(draft.id, 1)).status, 'draft');
    assert.equal(confirmed.rows[3].status, 'error');
    assert.equal(await prisma.catalogImportRevision.count({ where: { importId: draft.id } }), 2);
    const offers = await prisma.catalogOffer.findMany({ where: { createdBy: actor } });
    assert.equal(offers.length, 3);
    assert(offers.some((o) => o.unitPrice === null));
    assert(offers.some((o) => o.unitPrice?.toString() === '0'));
    assert(
      offers.every(
        (o) => (o.importProvenance as { checksum: string }).checksum === attachment.checksum,
      ),
    );
    await assert.rejects(
      mutateImport(draft.id, { action: 'confirm', revision: 1, rowIds: [draft.rows[0].id] }, actor),
    );
    const newBytes = Buffer.from('name;sku;unit;price\nA;A;шт;20');
    const next = await createImport(newBytes, 'next.csv', profile, actor);
    const races = await Promise.allSettled([
      mutateImport(next.id, { action: 'confirm', revision: 1, rowIds: [next.rows[0].id] }, actor),
      mutateImport(next.id, { action: 'confirm', revision: 1, rowIds: [next.rows[0].id] }, actor),
    ]);
    assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await prisma.catalogOffer.count({ where: { createdBy: actor } }), 4);
    assert.deepEqual(
      (await loadImport(draft.id)).rows,
      confirmed.rows,
      'new price list preserves prior source/confirmation',
    );
    const bad = await createImport(
      Buffer.from('name;sku;unit;price\nFix;F;;?'),
      'bad.csv',
      profile,
      actor,
    );
    const corrected = await mutateImport(
      bad.id,
      {
        action: 'correct',
        revision: 1,
        rowId: bad.rows[0].id,
        normalized: {
          product: {
            vendorId: vendor.id,
            name: 'Fix',
            sku: 'F',
            edition: '',
            kind: 'hardware',
            unit: 'шт',
            licensing: '',
            attributes: [],
          },
          offer: {
            source: 'Manual correction',
            unitPrice: null,
            currency: 'RUB',
            region: '',
            terms: '',
            priceDate: null,
            validUntil: null,
          },
        },
      },
      actor,
    );
    assert.equal(corrected.rows[0].status, 'ready');
    assert.deepEqual(corrected.rows[0].raw, bad.rows[0].raw);
    console.log(
      'GPL PostgreSQL passed: persistence, attachment SHA256, concurrent upload idempotency, selected confirmation, raw correction history, null/zero/decimal, immutable old prices, concurrent confirmation conflict.',
    );
  } finally {
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
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
