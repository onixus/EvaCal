/** #101 WP5: versioned sizing against an isolated, migrated CI PostgreSQL. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { loadSpecification, saveSpecification } from '../lib/specification/store';
import {
  approveVersion,
  createManualRun,
  createProfileRun,
  createVersion,
  listProfiles,
  loadRun,
  updateDraftVersion,
} from '../lib/sizing/store';
import { applySizingImpact, linkSizing, previewSizingImpact } from '../lib/sizing/service';
import { BUILTIN_SIZING_PROFILES } from '../lib/sizing/builtin';

async function rejects(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, Error, message);
}

async function main() {
  // Seeded approved v1 profiles.
  const profiles = await listProfiles();
  for (const builtin of BUILTIN_SIZING_PROFILES) {
    const profile = profiles.find((p) => p.key === builtin.key);
    const v1 = profile?.versions.find((v) => v.version === 1);
    assert.equal(v1?.status, 'approved', `${builtin.key} v1 seeded as approved`);
    assert.deepEqual(v1?.rules, builtin.rules, `${builtin.key} v1 rules seeded verbatim`);
  }
  const ngfw = profiles.find((p) => p.key === 'ngfw')!;
  const v1 = ngfw.versions.find((v) => v.version === 1)!;

  // Approved versions are immutable in the database, not only in the service.
  await rejects(
    prisma.sizingProfileVersion.update({ where: { id: v1.id }, data: { source: 'tampered' } }),
    'trigger blocks editing an approved version',
  );
  await rejects(
    prisma.sizingProfileVersion.delete({ where: { id: v1.id } }),
    'trigger blocks deleting an approved version',
  );
  await rejects(updateDraftVersion(v1.id, { source: 'x' }), 'service rejects approved edit');
  await rejects(
    prisma.$executeRaw`UPDATE "SizingProfileVersion" SET "status" = 'bogus' WHERE id = ${v1.id}`,
    'status CHECK/guard',
  );

  const template = await prisma.formTemplate.create({ data: { name: `sizing-${randomUUID()}` } });
  try {
    const calculation = await prisma.calculation.create({
      data: { templateId: template.id, name: 'Сайзинг', customer: 'CI', answers: '{}' },
    });
    const inputs = { ngfw_clusters_count: 1, ngfw_ha_required: false };
    const run1 = await createProfileRun(
      calculation.id,
      { profileVersionId: v1.id, inputs },
      'presale',
    );
    assert.equal(run1.profileVersionId, v1.id, 'run pins the profile version');
    assert.equal(run1.outputs.base.find((o) => o.key === 'nodes')?.value, 1);
    assert.equal(
      run1.outputs.base.find((o) => o.key === 'target_throughput')?.value,
      null,
      'missing throughput stays unknown',
    );
    await rejects(
      prisma.sizingRun.update({ where: { id: run1.id }, data: { note: 'x' } }),
      'runs are append-only',
    );

    // Specification with one supplied row linked to the nodes metric.
    const base = {
      version: 0,
      status: 'draft',
      emptySupplyReason: '',
      items: [
        {
          id: 'ngfw-node',
          kind: 'hardware',
          disposition: 'supply',
          name: 'Узел NGFW',
          vendor: 'Вендор',
          sku: 'NGFW-1',
          quantity: '1',
          unit: 'шт.',
          configuration: '',
          licensing: '',
          term: '',
          source: 'КП',
          rationale: 'сайзинг',
          confirmed: true,
          unitPrice: '1000.10',
          currency: 'RUB',
        },
      ],
    };
    const first = await saveSpecification(calculation.id, base, 'presale');
    const linked = await linkSizing(
      calculation.id,
      { version: first.snapshot.version, itemId: 'ngfw-node', runId: run1.id, metric: 'nodes' },
      'presale',
    );
    assert.deepEqual(linked.snapshot.sizingRunIds, [run1.id], 'snapshot records sizing run');
    assert.equal(linked.snapshot.items[0].sizingRef?.requiredQuantity, '1');
    await rejects(
      saveSpecification(
        calculation.id,
        {
          ...linked.snapshot,
          items: [
            {
              ...linked.snapshot.items[0],
              sizingRef: { ...linked.snapshot.items[0].sizingRef!, requiredQuantity: '9' },
            },
          ],
        },
        'presale',
      ),
      'forged requirement rejected',
    );

    // A new profile version (HA formula changed: triple nodes) does not change old runs.
    const v2 = await createVersion(
      ngfw.id,
      {
        rules: {
          ...v1.rules,
          outputs: v1.rules.outputs.map((o) =>
            o.key === 'nodes'
              ? { ...o, formula: 'ngfw_clusters_count * (ngfw_ha_required ? 3 : 2)' }
              : o,
          ),
        },
        assumptions: v1.assumptions,
        source: 'CI: изменение профиля',
      },
      'architect',
    );
    assert.equal(v2.status, 'draft');
    await rejects(
      createProfileRun(calculation.id, { profileVersionId: v2.id, inputs }, 'presale'),
      'runs require an approved version',
    );
    // Preview by the draft profile (architect) — before applying anything.
    const draftPreview = await previewSizingImpact(
      calculation.id,
      { profileVersionId: v2.id, inputs },
      { allowDraft: true },
    );
    assert.equal(draftPreview.rows[0].status, 'deficit');
    assert.equal(draftPreview.rows[0].proposedQuantity, '2');
    assert.equal(draftPreview.totals.after[0].total, '2000.2');
    await rejects(
      previewSizingImpact(
        calculation.id,
        { profileVersionId: v2.id, inputs },
        { allowDraft: false },
      ),
      'presale cannot preview a draft profile',
    );
    await approveVersion(v2.id, 'architect');
    const run2 = await createProfileRun(
      calculation.id,
      { profileVersionId: v2.id, inputs },
      'presale',
    );
    const old = await loadRun(calculation.id, run1.id);
    assert.equal(old.profile?.version, 1, 'old run still pinned to v1');
    assert.equal(old.outputs.base.find((o) => o.key === 'nodes')?.value, 1, 'old outputs kept');

    // Changing inputs separately: HA on with v1.
    const run3 = await createProfileRun(
      calculation.id,
      { profileVersionId: v1.id, inputs: { ...inputs, ngfw_ha_required: true } },
      'presale',
    );
    const inputPreview = await previewSizingImpact(
      calculation.id,
      { runId: run3.id },
      { allowDraft: false },
    );
    assert.equal(inputPreview.rows[0].proposedQuantity, '2');

    // Apply the new profile run: a new draft revision; the previous revision is untouched.
    const before = await loadSpecification(calculation.id);
    const applied = await applySizingImpact(
      calculation.id,
      {
        runId: run2.id,
        version: before!.snapshot.version,
        selections: [{ itemId: 'ngfw-node' }],
      },
      'presale',
    );
    assert.equal(applied.snapshot.status, 'draft');
    assert.equal(applied.snapshot.version, before!.snapshot.version + 1);
    assert.equal(applied.snapshot.items[0].quantity, '2');
    assert.equal(applied.snapshot.items[0].confirmed, false, 'changed row needs re-confirmation');
    assert.deepEqual(applied.snapshot.sizingRunIds, [run2.id]);
    assert.deepEqual(
      (await loadSpecification(calculation.id, before!.snapshot.version))?.snapshot,
      before!.snapshot,
      'previous revision unchanged',
    );
    await rejects(
      applySizingImpact(
        calculation.id,
        {
          runId: run2.id,
          version: before!.snapshot.version,
          selections: [{ itemId: 'ngfw-node' }],
        },
        'presale',
      ),
      'stale revision rejected',
    );

    // Manual sizing is a run too; a manual quantity is not replaced without consent.
    const manual = await createManualRun(
      calculation.id,
      {
        note: 'Оценка архитектора',
        outputs: [{ key: 'nodes', label: 'Узлы', kind: 'nodes', unit: 'шт.', value: 4 }],
      },
      'architect',
    );
    assert.equal(manual.source, 'manual');
    const edited = await saveSpecification(
      calculation.id,
      { ...applied.snapshot, items: [{ ...applied.snapshot.items[0], quantity: '3' }] },
      'presale',
    );
    const manualPreview = await previewSizingImpact(
      calculation.id,
      { runId: manual.id },
      { allowDraft: false },
    );
    assert.equal(manualPreview.rows[0].manualQuantity, true);
    assert.deepEqual(manualPreview.selections, []);
    await rejects(
      applySizingImpact(
        calculation.id,
        {
          runId: manual.id,
          version: edited.snapshot.version,
          selections: [{ itemId: 'ngfw-node' }],
        },
        'presale',
      ),
      'manual quantity requires explicit consent',
    );

    // Cascade from calculation still removes append-only runs.
    await prisma.calculation.delete({ where: { id: calculation.id } });
    assert.equal(await prisma.sizingRun.count({ where: { calculationId: calculation.id } }), 0);
    // Test-only cleanup of the draft-then-approved v2 is impossible by design (immutable).
  } finally {
    await prisma.formTemplate.delete({ where: { id: template.id } }).catch(() => undefined);
  }
  console.log('[verify-sizing] OK');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
