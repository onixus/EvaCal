// #101: relations, typed attributes, bundles, suggestions and explicit replacement
// against PostgreSQL. Called from scripts/verify-catalog.ts (test:catalog:postgres).
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { loadCatalog, mutateCatalog } from '../lib/catalog/store';
import { catalogItem } from '../lib/catalog/snapshot';
import {
  loadSpecification,
  markSpecificationReleased,
  saveSpecification,
} from '../lib/specification/store';
import { createSuggestion, listSuggestions, reviewSuggestion } from '../lib/catalog/suggestions';
import { applyReplacement, previewReplacements } from '../lib/specification/replacements';
import { expandBundle } from '../lib/catalog/relations';
import { summarizeSpecification } from '../lib/specification/totals';
import type { Product } from '../lib/catalog/types';

const rejects409 = (e: unknown) => (e as { statusCode?: number }).statusCode === 409;
const offer = (source: string, unitPrice: string) => ({
  source,
  unitPrice,
  currency: 'USD',
  region: '',
  terms: '',
  priceDate: null,
  validUntil: null,
});
const relation = (actor: string, relation: Record<string, unknown>) =>
  mutateCatalog({ action: 'relation.create', relation }, actor);

export async function cleanupRelations(actor: string) {
  await prisma.catalogSuggestion.deleteMany({
    where: { OR: [{ createdBy: actor }, { reviewer: actor }] },
  });
  await prisma.catalogProductRelation.deleteMany({ where: { createdBy: actor } });
  await prisma.catalogAttributeDefinition.deleteMany({ where: { createdBy: actor } });
}

export async function verifyRelations(actor: string, templateId: string) {
  const vendor = await mutateCatalog({ action: 'vendor.create', name: `${actor}-rel` }, actor);
  const base = {
    vendorId: vendor.id,
    edition: '',
    kind: 'hardware',
    unit: 'шт.',
    licensing: '',
    attributes: [] as Array<{ name: string; value: string; unit: string }>,
  };
  const make = (sku: string, patch: Record<string, unknown> = {}) =>
    mutateCatalog(
      { action: 'product.create', product: { ...base, name: `Сервер ${sku}`, sku, ...patch } },
      actor,
    );

  // Typed attributes: enforced on manual writes; unknown attributes allowed and flagged.
  const key = `ram-${actor}`;
  await mutateCatalog(
    {
      action: 'attribute.create',
      definition: {
        key,
        label: `RAM ${actor}`,
        valueType: 'number',
        unit: 'ГБ',
        allowedUnits: ['ГБ', 'ТБ'],
      },
    },
    actor,
  );
  await assert.rejects(
    mutateCatalog(
      { action: 'attribute.create', definition: { key, label: 'dup', valueType: 'text' } },
      actor,
    ),
    rejects409,
  );
  await assert.rejects(
    make('BAD', { attributes: [{ name: key, value: 'много', unit: 'ГБ' }] }),
    /требуется число/,
  );
  await assert.rejects(
    make('BAD2', { attributes: [{ name: key, value: '64', unit: 'МБ' }] }),
    /допустимые/,
  );
  const oldProduct = await make('OLD', {
    attributes: [
      { name: key, value: '64', unit: 'ГБ' },
      { name: 'EPS', value: '1', unit: '' },
    ],
  });
  const newProduct = await make('NEW');
  const newer = await make('NEWER');
  await mutateCatalog(
    { action: 'offer.create', id: oldProduct.id, revision: 1, offer: offer('Прайс', '10') },
    actor,
  );
  await mutateCatalog(
    { action: 'offer.create', id: newProduct.id, revision: 1, offer: offer('Прайс', '12') },
    actor,
  );
  let catalog = await loadCatalog();
  assert.deepEqual(catalog.products.find((p) => p.id === oldProduct.id)?.attributeFlags, [
    'Без справочника характеристик: EPS',
  ]);
  const old = JSON.parse(
    JSON.stringify(catalog.products.find((p) => p.id === oldProduct.id)),
  ) as Product;

  // A released revision references the old product.
  const calculation = await prisma.calculation.create({
    data: { templateId, name: `${actor}-rel`, customer: 'CI', answers: '{}' },
  });
  const manual = { ...catalogItem(old, old.offers[0], 'manual') };
  delete manual.origin;
  const released = await saveSpecification(
    calculation.id,
    {
      version: 0,
      status: 'confirmed',
      emptySupplyReason: '',
      items: [
        {
          ...catalogItem(old, old.offers[0], 'row-old'),
          quantity: '3',
          rationale: 'Сайзинг',
          confirmed: true,
        },
        {
          ...manual,
          name: 'Ручная позиция',
          sku: 'MANUAL-1',
          quantity: '1',
          rationale: 'Ручной ввод',
          confirmed: true,
        },
      ],
    },
    actor,
  );
  assert.equal(await markSpecificationReleased(calculation.id, 1), 1);

  // Withdrawn product: an archived product may still be the replaced side.
  await mutateCatalog({ action: 'product.archive', id: oldProduct.id, revision: 1 }, actor);
  await assert.rejects(
    relation(actor, {
      type: 'replaces',
      fromProductId: newProduct.id,
      toProductId: newProduct.id,
    }),
    /саму себя/,
  );
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "CatalogProductRelation" (id, "fromProductId", "toProductId", type, "createdBy") VALUES (${`${actor}-self`}, ${newProduct.id}, ${newProduct.id}, 'replaces', ${actor})`,
    'database rejects a self-relation',
  );
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "CatalogProductRelation" (id, "fromProductId", "toProductId", type, "createdBy") VALUES (${`${actor}-qty`}, ${newProduct.id}, ${newer.id}, 'bundleComponent', ${actor})`,
    'database requires a bundle quantity',
  );
  const replaces = await relation(actor, {
    type: 'replaces',
    fromProductId: newProduct.id,
    toProductId: oldProduct.id,
    note: 'EOL',
  });
  await relation(actor, { type: 'replaces', fromProductId: newer.id, toProductId: newProduct.id });
  await assert.rejects(
    relation(actor, { type: 'replaces', fromProductId: oldProduct.id, toProductId: newer.id }),
    /действующих/,
    'an archived product cannot become a replacement',
  );
  await assert.rejects(
    relation(actor, { type: 'replaces', fromProductId: newProduct.id, toProductId: oldProduct.id }),
    rejects409,
  );
  const a = await make('A'),
    b = await make('B');
  await relation(actor, { type: 'replaces', fromProductId: a.id, toProductId: b.id });
  await assert.rejects(
    relation(actor, { type: 'replaces', fromProductId: b.id, toProductId: a.id }),
    rejects409,
  );
  // Concurrent opposite replacements: the advisory lock admits exactly one.
  const c = await make('C'),
    d = await make('D');
  const race = await Promise.allSettled([
    relation(actor, { type: 'replaces', fromProductId: c.id, toProductId: d.id }),
    relation(actor, { type: 'replaces', fromProductId: d.id, toProductId: c.id }),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1, 'no concurrent cycle');

  // Bundles and alternatives.
  const kit = await make('KIT', { kind: 'bundle', unit: 'компл.' });
  await assert.rejects(
    relation(actor, {
      type: 'bundleComponent',
      fromProductId: newProduct.id,
      toProductId: newer.id,
      quantity: '1',
    }),
    /Комплект/,
  );
  await relation(actor, {
    type: 'bundleComponent',
    fromProductId: kit.id,
    toProductId: newer.id,
    quantity: '2',
  });
  // Kind changes must keep the composition consistent (409, nothing written).
  const kitNow = await prisma.catalogProduct.findUniqueOrThrow({ where: { id: kit.id } });
  await assert.rejects(
    mutateCatalog(
      {
        action: 'product.update',
        id: kit.id,
        revision: kitNow.revision,
        product: { ...base, name: 'Сервер KIT', sku: 'KIT', kind: 'hardware', unit: 'компл.' },
      },
      actor,
    ),
    (e) => rejects409(e) && /архивируйте связи состава/.test((e as Error).message),
  );
  const newerNow = await prisma.catalogProduct.findUniqueOrThrow({ where: { id: newer.id } });
  await assert.rejects(
    mutateCatalog(
      {
        action: 'product.update',
        id: newer.id,
        revision: newerNow.revision,
        product: { ...base, name: 'Сервер NEWER', sku: 'NEWER', kind: 'bundle' },
      },
      actor,
    ),
    (e) => rejects409(e) && /вложенные комплекты/.test((e as Error).message),
  );
  assert.equal(
    (await prisma.catalogProduct.findUniqueOrThrow({ where: { id: kit.id } })).kind,
    'bundle',
  );
  const alternative = await relation(actor, {
    type: 'alternative',
    fromProductId: c.id,
    toProductId: newer.id,
  });
  await assert.rejects(
    relation(actor, { type: 'alternative', fromProductId: newer.id, toProductId: c.id }),
    rejects409,
  );
  await mutateCatalog({ action: 'relation.archive', id: alternative.id }, actor);
  await relation(actor, { type: 'alternative', fromProductId: c.id, toProductId: newer.id });
  catalog = await loadCatalog();
  const products = JSON.parse(JSON.stringify(catalog.products)) as Product[];
  const rows = expandBundle(
    {
      ...catalogItem(
        products.find((p) => p.id === kit.id)!,
        undefined,
        'kit-row',
      ),
      quantity: '3',
      unitPrice: '100',
    },
    [
      {
        item: catalogItem(
          products.find((p) => p.id === newer.id)!,
          undefined,
          'kit-c',
        ),
        perBundle: '2',
      },
    ],
  );
  assert.equal(rows[1].quantity, '6');
  assert.equal(
    summarizeSpecification({ items: [rows[0], { ...rows[1], unitPrice: '50' }] })[0].total,
    '300',
    'bundle components are not double counted',
  );

  // Explicit replacement creates a new draft; the released revision is unchanged.
  const preview = await previewReplacements(calculation.id);
  assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0].itemId, 'row-old');
  assert(preview.candidates[0].productArchived);
  const newOffer = preview.candidates[0].options[0].offers[0];
  const replaced = await applyReplacement(
    calculation.id,
    { version: 1, itemId: 'row-old', relationId: replaces.id, offerId: newOffer.id },
    actor,
  );
  assert.equal(replaced.snapshot.version, 2);
  assert.equal(replaced.snapshot.status, 'draft');
  const row = replaced.snapshot.items.find((i) => i.id === 'row-old')!;
  assert.equal(row.sku, 'NEW');
  assert.equal(row.quantity, '3');
  assert.equal(row.unitPrice, '12');
  assert.equal(row.confirmed, false);
  assert.match(row.changeReason ?? '', /OLD .*NEW/);
  await assert.rejects(
    applyReplacement(
      calculation.id,
      { version: 1, itemId: 'row-old', relationId: replaces.id },
      actor,
    ),
    rejects409,
  );
  const reloaded = await loadSpecification(calculation.id, 1);
  assert.equal(reloaded?.snapshot.status, 'released');
  assert.deepEqual(reloaded?.snapshot.items, released.snapshot.items, 'released unchanged');
  assert.equal(
    (await previewReplacements(calculation.id)).candidates[0]?.options[0].productId,
    newer.id,
    'the replaced row is now offered the next replacement in the chain',
  );

  // Suggestions: manual saved rows only; accept → product + unconfirmed offer; reject → no change.
  await assert.rejects(
    createSuggestion(calculation.id, { version: 1, itemId: 'row-old' }, actor),
    rejects409,
  );
  const suggestion = await createSuggestion(
    calculation.id,
    { version: 1, itemId: 'manual' },
    actor,
  );
  await assert.rejects(
    createSuggestion(calculation.id, { version: 1, itemId: 'manual' }, actor),
    rejects409,
  );
  assert((await listSuggestions('pending')).some((s) => s.id === suggestion.id));
  const accepted = await reviewSuggestion(
    {
      action: 'accept',
      id: suggestion.id,
      product: { ...base, name: 'Ручная позиция', sku: 'MANUAL-1' },
      offer: offer('Из проекта', '10'),
    },
    actor,
  );
  assert.equal(accepted.status, 'accepted');
  const created = await prisma.catalogProduct.findUniqueOrThrow({
    where: { id: accepted.createdProductId! },
    include: { offers: true },
  });
  assert.equal(created.sku, 'MANUAL-1');
  assert.equal(created.offers[0].confirmationStatus, 'unconfirmed');
  await assert.rejects(
    reviewSuggestion({ action: 'reject', id: suggestion.id, comment: 'x' }, actor),
    rejects409,
  );
  const second = await createSuggestion(calculation.id, { version: 1, itemId: 'manual' }, actor);
  await assert.rejects(reviewSuggestion({ action: 'reject', id: second.id }, actor), /причину/);
  const before = await prisma.catalogProduct.count();
  const rejected = await reviewSuggestion(
    { action: 'reject', id: second.id, comment: 'Дубль' },
    actor,
  );
  assert.equal(rejected.status, 'rejected');
  assert.equal(await prisma.catalogProduct.count(), before);
  // Failed acceptance leaves the suggestion pending and creates nothing (one transaction).
  const third = await createSuggestion(calculation.id, { version: 1, itemId: 'manual' }, actor);
  const archivedVendor = await mutateCatalog(
    { action: 'vendor.create', name: `${actor}-arch` },
    actor,
  );
  await mutateCatalog({ action: 'vendor.archive', id: archivedVendor.id, revision: 1 }, actor);
  await assert.rejects(
    reviewSuggestion(
      {
        action: 'accept',
        id: third.id,
        product: { ...base, vendorId: archivedVendor.id, name: 'X', sku: 'X' },
        offer: offer('X', '1'),
      },
      actor,
    ),
  );
  assert.equal(
    (await prisma.catalogSuggestion.findUniqueOrThrow({ where: { id: third.id } })).status,
    'pending',
  );
  assert.equal(await prisma.catalogProduct.count(), before);
  assert.deepEqual(
    (await loadSpecification(calculation.id, 1))?.snapshot.items,
    released.snapshot.items,
    'suggestions never change the project',
  );

  // Bundle → bundle replacement rebuilds the composition; bundle → non-bundle needs consent.
  const kit2 = await make('KIT2', { kind: 'bundle', unit: 'компл.' });
  await relation(actor, {
    type: 'bundleComponent',
    fromProductId: kit2.id,
    toProductId: c.id,
    quantity: '3',
  });
  const kitReplaced = await relation(actor, {
    type: 'replaces',
    fromProductId: kit2.id,
    toProductId: kit.id,
  });
  const plainForKit = await relation(actor, {
    type: 'replaces',
    fromProductId: d.id,
    toProductId: kit.id,
  });
  catalog = await loadCatalog();
  const current = JSON.parse(JSON.stringify(catalog.products)) as Product[];
  const bundleCalc = await prisma.calculation.create({
    data: { templateId, name: `${actor}-bundle`, customer: 'CI', answers: '{}' },
  });
  const bundleRows = expandBundle(
    {
      ...catalogItem(
        current.find((p) => p.id === kit.id)!,
        undefined,
        'kit-row',
      ),
      quantity: '2',
    },
    [
      {
        item: catalogItem(
          current.find((p) => p.id === newer.id)!,
          undefined,
          'kit-comp',
        ),
        perBundle: '2',
      },
    ],
  );
  await saveSpecification(
    bundleCalc.id,
    { version: 0, status: 'draft', emptySupplyReason: '', items: bundleRows },
    actor,
  );
  await assert.rejects(
    applyReplacement(
      bundleCalc.id,
      { version: 1, itemId: 'kit-row', relationId: plainForKit.id },
      actor,
    ),
    /подтвердите удаление состава/,
  );
  const rebuilt = await applyReplacement(
    bundleCalc.id,
    { version: 1, itemId: 'kit-row', relationId: kitReplaced.id },
    actor,
  );
  assert.deepEqual(
    rebuilt.snapshot.items.map((i) => [i.sku, i.quantity, i.includedIn ?? '']),
    [
      ['KIT2', '2', ''],
      ['C', '6', 'kit-row'],
    ],
  );
  // Suggestions are removed together with their calculation (FK cascade).
  const manualRow = {
    ...catalogItem(
      current.find((p) => p.id === c.id)!,
      undefined,
      'm',
    ),
  };
  delete manualRow.origin;
  await saveSpecification(
    bundleCalc.id,
    { ...rebuilt.snapshot, items: [...rebuilt.snapshot.items, { ...manualRow, name: 'Ручная' }] },
    actor,
  );
  await createSuggestion(bundleCalc.id, { version: 3, itemId: 'm' }, actor);
  await prisma.calculation.delete({ where: { id: bundleCalc.id } });
  assert.equal(
    await prisma.catalogSuggestion.count({ where: { calculationId: bundleCalc.id } }),
    0,
  );
}
