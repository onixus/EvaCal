import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import type { ImportProfile } from '../lib/catalog/import-types';
import { mutateCatalog } from '../lib/catalog/store';
import {
  createImport,
  mutateImport,
  loadImport,
  importAttachment,
} from '../lib/catalog/import-store';
import { listImportProfiles, mutateImportProfile } from '../lib/catalog/import-profiles';
// Save a profile from the first file, then reuse it on a second file whose columns
// are reordered and renamed in part: header matching follows the move and reports
// the missing column; new fields persist on confirmed offers as confirmed prices.
async function verifyProfiles(actor: string, vendorId: string) {
  const first = await createImport(
    Buffer.from(
      'Название;Артикул;Ед.;Цена;Дата прайса;Действует до;НДС;Тип;RAM\n' +
        'Сервер;PRF-1;шт;100,5;01.10.2026;31.12.2026;20%;Оборудование;64\n',
    ),
    'profile-1.csv',
    {
      vendorId,
      delimiter: ';',
      decimalSeparator: ',',
      mapping: {
        name: 0,
        sku: 1,
        unit: 2,
        unitPrice: 3,
        priceDate: 4,
        validUntil: 5,
        taxRate: 6,
        kind: 7,
      },
      attributes: [{ column: 8, name: 'Память', unit: 'ГБ' }],
    },
    actor,
  );
  assert.deepEqual(first.rows[0].errors, []);
  const saved = await mutateImportProfile(
    { action: 'create', name: 'Основной CSV', importId: first.id },
    actor,
  );
  await assert.rejects(
    mutateImportProfile({ action: 'create', name: 'Основной CSV', importId: first.id }, actor),
    (e: { statusCode?: number }) => e.statusCode === 409,
  );
  assert.equal((await listImportProfiles(vendorId)).length, 1);
  const second = await createImport(
    Buffer.from(
      'RAM;Тип;Артикул;Цена;Название;Ед.;Дата прайса;Ставка НДС\n' +
        '128;ПО;PRF-2;;Сервер 2;шт;;\n' +
        '256;гаджет;PRF-3;7;Сервер 3;шт;2026-13-01;\n',
    ),
    'profile-2.csv',
    { vendorId, savedProfileId: saved.id, savedProfileRevision: saved.revision },
    actor,
  );
  assert.equal(second.profileApplication?.profileId, saved.id);
  assert.deepEqual(second.profile.mapping, {
    name: 4,
    sku: 2,
    unit: 5,
    unitPrice: 3,
    priceDate: 6,
    kind: 1,
  });
  assert.deepEqual(second.profile.attributes, [{ column: 0, name: 'Память', unit: 'ГБ' }]);
  assert.deepEqual(second.profileApplication?.mismatches, [
    'Действует до: колонка «Действует до» не найдена в файле',
    'НДС, %: колонка «НДС» не найдена в файле',
  ]);
  assert.deepEqual(second.profileApplication?.added, ['Ставка НДС']);
  const [unknown, bad] = second.rows;
  assert.deepEqual(unknown.errors, []);
  assert.equal(unknown.normalized?.offer.unitPrice, null, 'missing price is unknown');
  assert.equal(unknown.normalized?.offer.priceDate, null, 'missing date is unknown');
  assert.equal(unknown.normalized?.product.kind, 'software');
  assert.match(bad.errors.join(), /Тип позиции: «гаджет»/);
  assert.match(bad.errors.join(), /Дата цены: «2026-13-01»/);
  // Stale profile revision is refused.
  await mutateImportProfile(
    { action: 'update', id: saved.id, revision: saved.revision, importId: first.id },
    actor,
  );
  await assert.rejects(
    createImport(
      Buffer.from('Артикул;Название\nX;Y\n'),
      'profile-3.csv',
      { vendorId, savedProfileId: saved.id, savedProfileRevision: saved.revision },
      actor,
    ),
    (e: { statusCode?: number }) => e.statusCode === 409,
  );
  const confirmed = await mutateImport(
    first.id,
    { action: 'confirm', revision: first.revision, rowIds: [first.rows[0].id] },
    actor,
  );
  assert.equal(confirmed.status, 'confirmed');
  const product = await prisma.catalogProduct.findFirstOrThrow({
    where: { vendorId, sku: 'PRF-1' },
    include: { offers: true },
  });
  assert.deepEqual(product.attributes, [{ name: 'Память', value: '64', unit: 'ГБ' }]);
  const offer = product.offers[0];
  assert.equal(offer.taxRate?.toString(), '20');
  assert.equal(offer.priceDate, '2026-10-01');
  assert.equal(offer.validUntil, '2026-12-31');
  assert.equal(offer.confirmationStatus, 'confirmed');
  assert.equal(offer.confirmedBy, actor);
  // A manual offer stays unconfirmed until the explicit, single confirmation action.
  const manual = await mutateCatalog(
    {
      action: 'offer.create',
      id: product.id,
      revision: product.revision,
      offer: {
        source: 'Ручной ввод',
        unitPrice: null,
        currency: 'RUB',
        region: '',
        terms: '',
        priceDate: null,
        validUntil: null,
        taxRate: null,
        discountCategory: '',
        confirmationStatus: 'confirmed',
      },
    },
    actor,
  );
  assert.equal((manual as { confirmationStatus: string }).confirmationStatus, 'unconfirmed');
  await mutateCatalog({ action: 'offer.confirm', id: product.id, offerId: manual.id }, actor);
  await assert.rejects(
    mutateCatalog({ action: 'offer.confirm', id: product.id, offerId: manual.id }, actor),
    (e: { statusCode?: number }) => e.statusCode === 409,
  );
  const after = await prisma.catalogOffer.findUniqueOrThrow({ where: { id: manual.id } });
  assert.equal(after.confirmationStatus, 'confirmed');
  assert.equal(after.unitPrice, null, 'confirmation does not invent a price');
}
// Hold a newly inserted product uncommitted behind Vendor. The import first
// sees no candidate, queues on Vendor, and only sees the product after release.
async function verifyProductAppearance(
  actor: string,
  profile: Pick<ImportProfile, 'vendorId'> & Record<string, unknown>,
) {
  const draft = await createImport(
    Buffer.from('name;sku;unit;price\nRace;RACE;шт;1'),
    'race.csv',
    profile,
    actor,
  );
  let ready!: () => void, release!: () => void;
  const acquired = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let productId = '';
  const creator = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CatalogVendor" WHERE id = ${profile.vendorId} FOR UPDATE`;
      const technical = draft.rows[0].normalized!.product;
      const product = await tx.catalogProduct.create({
        data: {
          ...technical,
          attributes: technical.attributes.map((a) => ({ ...a })),
          createdBy: actor,
        },
      });
      productId = product.id;
      ready();
      await gate;
    },
    { timeout: 15000 },
  );
  let confirmation: Promise<{ error?: unknown }> | undefined;
  try {
    await acquired;
    confirmation = mutateImport(
      draft.id,
      { action: 'confirm', revision: 1, rowIds: [draft.rows[0].id] },
      actor,
    ).then(
      () => ({}),
      (error) => ({ error }),
    );
    let observed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await prisma.$queryRaw<
        Array<{ n: bigint }>
      >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT id,name,revision,archived FROM "CatalogVendor"%' AND pid <> pg_backend_pid()`;
      if (Number(waiting[0].n) > 0) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(observed, 'import must read empty candidates and queue behind Vendor');
  } finally {
    release();
    await creator;
  }
  const result = await confirmation!;
  assert.equal(
    (result.error as { statusCode?: number })?.statusCode,
    409,
    'new matching product must cause retriable 409, never an FK lock acquired under Vendor',
  );
  assert.equal((await loadImport(draft.id)).revision, 1, 'conflict must not append history');
  assert.equal(
    await prisma.catalogOffer.count({ where: { productId } }),
    0,
    'conflict must not insert offers',
  );
  const retry = await mutateImport(
    draft.id,
    { action: 'confirm', revision: 1, rowIds: [draft.rows[0].id] },
    actor,
  );
  assert.equal(retry.status, 'confirmed');
  assert.equal(
    await prisma.catalogProduct.count({ where: { vendorId: profile.vendorId, sku: 'RACE' } }),
    1,
    'retry reuses prelocked product',
  );
  assert.equal(await prisma.catalogOffer.count({ where: { productId } }), 1);
}
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
    await verifyProductAppearance(actor, profile);
    await verifyProfiles(actor, vendor.id);
    console.log(
      'GPL PostgreSQL passed: persistence, attachment SHA256, concurrent upload idempotency, selected confirmation, raw correction history, null/zero/decimal, immutable old prices, concurrent confirmation conflict, newly appeared product 409 with zero writes and successful retry, saved profile reuse on reordered columns with mismatch report, extended fields and offer confirmation status.',
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
    await prisma.catalogImportProfile.deleteMany({ where: { createdBy: actor } });
    await prisma.catalogVendor.deleteMany({ where: { createdBy: actor } });
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
