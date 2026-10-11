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

  // Catalog changes do not rewrite the released revision; an unchanged confirmed row
  // keeps its copy, a re-confirmed row gets the current catalog evidence.
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
  const v2 = await saveSpecification(calculation.id, { ...v1.snapshot, status: 'draft' }, actor);
  assert.deepEqual(v2.snapshot.items.find((i) => i.id === 'os')!.evidence, copied);
  const v3 = await saveSpecification(
    calculation.id,
    {
      ...v2.snapshot,
      items: v2.snapshot.items.map((i) => (i.id === 'os' ? { ...i, confirmed: false } : i)),
    },
    actor,
  );
  const v4 = await saveSpecification(
    calculation.id,
    {
      ...v3.snapshot,
      items: v3.snapshot.items.map((i) => (i.id === 'os' ? { ...i, confirmed: true } : i)),
    },
    actor,
  );
  assert.equal(v4.snapshot.items.find((i) => i.id === 'os')!.evidence?.[0].status, 'revoked');
  await mutateCatalog({ action: 'evidence.archive', id: created.id, revision: 2 }, actor);
  const v5 = await saveSpecification(
    calculation.id,
    {
      ...v4.snapshot,
      items: v4.snapshot.items.map((i) => (i.id === 'os' ? { ...i, quantity: '2' } : i)),
    },
    actor,
  );
  assert.equal(
    v5.snapshot.items.find((i) => i.id === 'os')!.evidence?.[0].status,
    'revoked',
    'a confirmed row keeps its copied evidence across edits',
  );
  const v6 = await saveSpecification(
    calculation.id,
    {
      ...v5.snapshot,
      items: v5.snapshot.items.map((i) => (i.id === 'os' ? { ...i, confirmed: false } : i)),
    },
    actor,
  );
  assert.equal(
    v6.snapshot.items.find((i) => i.id === 'os')!.evidence,
    undefined,
    'archived evidence is not copied into new revisions',
  );
  const released = await loadSpecification(calculation.id, 1);
  assert.equal(released?.snapshot.status, 'released');
  assert.deepEqual(released?.snapshot.items, v1.snapshot.items, 'released revision unchanged');
}
