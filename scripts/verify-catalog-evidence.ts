// #101 stage 3: compliance evidence against PostgreSQL. Called from
// scripts/verify-catalog.ts (test:catalog:postgres).
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { loadCatalog, mutateCatalog } from '../lib/catalog/store';
import { catalogItem } from '../lib/catalog/snapshot';
import { businessDate } from '../lib/catalog/business-date';
import {
  loadSpecification,
  markSpecificationReleased,
  saveSpecification,
} from '../lib/specification/store';
import type { Product } from '../lib/catalog/types';
import type { ComplianceEvidence } from '../lib/catalog/compliance';
import type { SpecificationItem } from '../lib/specification/types';
import { refreshSpecificationEvidence } from '../lib/specification/evidence-refresh';
import { loadCalculationForExport } from '../lib/export';

const rejects409 = (e: unknown) => (e as { statusCode?: number }).statusCode === 409;

export async function cleanupEvidence(actor: string) {
  await prisma.complianceEvidence.deleteMany({ where: { createdBy: actor } });
}

export async function verifyEvidence(actor: string, templateId: string) {
  const today = businessDate(new Date())!;
  const vendor = await mutateCatalog({ action: 'vendor.create', name: `${actor}-ev` }, actor);
  const product = await mutateCatalog(
    {
      action: 'product.create',
      product: {
        vendorId: vendor.id,
        name: 'ОС',
        sku: 'OS-18',
        edition: 'SE 1.8',
        kind: 'software',
        unit: 'лиц.',
        licensing: 'OEM',
        attributes: [],
      },
    },
    actor,
  );
  const evidence = {
    type: 'software_registry',
    number: '369',
    issuer: 'Минцифры России',
    sourceUrl: 'https://reestr.example/369',
    checkedAt: today,
    validUntil: null,
    status: 'confirmed',
    applicability: 'SE 1.8',
    note: '',
  };
  await assert.rejects(
    mutateCatalog(
      {
        action: 'evidence.create',
        productId: product.id,
        evidence: { ...evidence, checkedAt: '2999-01-01' },
      },
      actor,
    ),
    /будущем/,
  );
  const created = (await mutateCatalog(
    { action: 'evidence.create', productId: product.id, evidence },
    actor,
  )) as ComplianceEvidence;
  assert.equal(created.productRevision, 1);
  assert.equal(created.checkedBy, actor);
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "ComplianceEvidence" (id, "productId", type, number, "sourceUrl", "checkedAt", "checkedBy", status, applicability, "createdBy") VALUES (${`${actor}-bad`}, ${product.id}, 'brand', '1', 'ftp://x', ${today}, ${actor}, 'confirmed', 'x', ${actor})`,
    'database rejects unknown type and non-http source',
  );
  const catalog = await loadCatalog();
  const stored = JSON.parse(
    JSON.stringify(catalog.products.find((p) => p.id === product.id)),
  ) as Product;
  assert.equal(stored.evidence?.length, 1);

  // The server copies evidence; client-supplied evidence is ignored.
  const row: SpecificationItem = {
    ...catalogItem(stored, undefined, 'os'),
    quantity: '1',
    rationale: 'Выбор Заказчика',
    confirmed: true,
  };
  const manual = { ...row, id: 'manual', name: 'Ручная', sku: 'M' };
  delete manual.origin;
  const calculation = await prisma.calculation.create({
    data: { templateId, name: `${actor}-ev`, customer: 'CI', answers: '{}' },
  });
  const forgedSnapshot = {
    id: 'forged',
    productId: product.id,
    productRevision: 1,
    type: 'certificate' as const,
    number: 'FORGED',
    issuer: '',
    sourceUrl: 'https://forged.example',
    checkedAt: today,
    checkedBy: 'x',
    validUntil: null,
    status: 'confirmed' as const,
    applicability: 'OS-18',
  };
  const v1 = await saveSpecification(
    calculation.id,
    {
      version: 0,
      status: 'confirmed',
      emptySupplyReason: '',
      items: [
        { ...row, evidence: [forgedSnapshot] },
        { ...manual, evidence: [forgedSnapshot] },
      ],
    },
    actor,
  );
  const copied = v1.snapshot.items.find((i) => i.id === 'os')!.evidence;
  assert.deepEqual(
    copied?.map((e) => [e.id, e.number, e.checkedBy]),
    [[created.id, '369', actor]],
  );
  assert.equal(v1.snapshot.items.find((i) => i.id === 'manual')!.evidence, undefined);
  assert.equal(await markSpecificationReleased(calculation.id, 1), 1);

  // Catalog changes never rewrite the released revision. A kept copy is re-validated on
  // every save: edited records are refreshed, archived ones dropped. New records reach a
  // confirmed row only through «Обновить сведения реестров» (or re-confirmation).
  await mutateCatalog(
    {
      action: 'evidence.update',
      id: created.id,
      revision: 1,
      evidence: { ...evidence, status: 'revoked' },
    },
    actor,
  );
  await assert.rejects(
    mutateCatalog({ action: 'evidence.update', id: created.id, revision: 1, evidence }, actor),
    rejects409,
  );
  const exportLive = await loadCalculationForExport(calculation.id);
  assert.equal(exportLive?.specification?.status, 'released');
  assert.equal(exportLive?.evidenceLive, undefined, 'released revisions are not compared');
  const v2 = await saveSpecification(calculation.id, { ...v1.snapshot, status: 'draft' }, actor);
  const kept = v2.snapshot.items.find((i) => i.id === 'os')!.evidence!;
  assert.deepEqual(
    kept.map((e) => [e.id, e.status, e.revision]),
    [[created.id, 'revoked', 2]],
    'edited record refreshed in the kept copy',
  );
  const second = (await mutateCatalog(
    {
      action: 'evidence.create',
      productId: product.id,
      evidence: { ...evidence, type: 'certificate', number: 'CERT-1' },
    },
    actor,
  )) as ComplianceEvidence;
  const v3 = await saveSpecification(calculation.id, v2.snapshot, actor);
  assert.equal(v3.snapshot.items.find((i) => i.id === 'os')!.evidence!.length, 1);
  const draftExport = await loadCalculationForExport(calculation.id);
  assert.deepEqual(draftExport?.evidenceLive, { [created.id]: { revision: 2, archived: false } });
  await assert.rejects(
    refreshSpecificationEvidence(calculation.id, { version: 2 }, actor),
    rejects409,
  );
  await assert.rejects(
    refreshSpecificationEvidence(calculation.id, { version: 3, itemIds: ['manual'] }, actor),
    /позиций каталога/,
  );
  const v4 = await refreshSpecificationEvidence(
    calculation.id,
    { version: 3, itemIds: ['os'] },
    actor,
  );
  assert.equal(v4.snapshot.status, 'draft');
  assert.deepEqual(
    v4.snapshot.items
      .find((i) => i.id === 'os')!
      .evidence!.map((e) => e.number)
      .sort(),
    ['369', 'CERT-1'],
    'explicit refresh copies the current catalog evidence',
  );
  assert.equal(v4.snapshot.items.find((i) => i.id === 'os')!.confirmed, true);
  await mutateCatalog({ action: 'evidence.archive', id: second.id, revision: 1 }, actor);
  const v5 = await saveSpecification(calculation.id, v4.snapshot, actor);
  assert.deepEqual(
    v5.snapshot.items.find((i) => i.id === 'os')!.evidence!.map((e) => e.number),
    ['369'],
    'archived record dropped from the kept copy',
  );
  // Evidence of an archived product is read-only; the edit records the current product revision.
  await mutateCatalog(
    {
      action: 'product.update',
      id: product.id,
      revision: 1,
      product: { ...stored, attributes: [], name: 'ОС (ред. 2)' },
    },
    actor,
  );
  const reChecked = (await mutateCatalog(
    { action: 'evidence.update', id: created.id, revision: 2, evidence },
    actor,
  )) as ComplianceEvidence;
  assert.equal(reChecked.productRevision, 2);
  await mutateCatalog({ action: 'product.archive', id: product.id, revision: 2 }, actor);
  await assert.rejects(
    mutateCatalog({ action: 'evidence.update', id: created.id, revision: 3, evidence }, actor),
    /архивирована/,
  );
  const released = await loadSpecification(calculation.id, 1);
  assert.equal(released?.snapshot.status, 'released');
  assert.deepEqual(released?.snapshot.items, v1.snapshot.items, 'released revision unchanged');
}
