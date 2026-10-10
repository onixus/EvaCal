/** Concurrent append-only BOM integration against an isolated, migrated CI DB. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import {
  saveSpecification,
  loadSpecification,
  markSpecificationReleased,
} from '../lib/specification/store';
import { prepareGost34Document } from '../lib/gost34/generation/prepareDocument';

async function main() {
  const template = await prisma.formTemplate.create({
    data: { name: `spec-probe-${randomUUID()}` },
  });
  try {
    const calculation = await prisma.calculation.create({
      data: { templateId: template.id, name: 'Спецификация', customer: 'CI', answers: '{}' },
    });
    const draft = { version: 0, status: 'draft', emptySupplyReason: '', items: [] };
    const races = await Promise.allSettled([
      saveSpecification(calculation.id, draft, 'editor-a'),
      saveSpecification(calculation.id, draft, 'editor-b'),
    ]);
    assert.equal(
      races.filter((r) => r.status === 'fulfilled').length,
      1,
      'one concurrent revision wins',
    );
    const loser = races.find((r) => r.status === 'rejected');
    assert(
      loser?.status === 'rejected' && loser.reason.statusCode === 409,
      'stale edit rejected with 409',
    );
    const first = await loadSpecification(calculation.id);
    assert.equal(first?.snapshot.version, 1);
    const confirmed = await saveSpecification(
      calculation.id,
      {
        ...draft,
        version: 1,
        status: 'confirmed',
        emptySupplyReason: 'Облачные ресурсы заказчика',
      },
      'architect',
    );
    assert.equal(confirmed.snapshot.version, 2);
    assert.deepEqual(
      (await loadSpecification(calculation.id, 1))?.snapshot,
      first?.snapshot,
      'old revision unchanged',
    );
    assert.deepEqual(
      (await loadSpecification(calculation.id, 2))?.snapshot,
      confirmed.snapshot,
      'saved source roundtrips',
    );
    const document = prepareGost34Document({
      calculation: { name: 'Спецификация', customer: 'CI', specification: confirmed.snapshot },
      metadataOverride: { docType: 'SPEC' },
    });
    assert.equal(document.diagnostics.issues.length, 0);
    // Lifecycle: confirmed → review → confirmed → released → new draft edition.
    const review = await saveSpecification(
      calculation.id,
      { ...confirmed.snapshot, status: 'review' },
      'presale',
    );
    assert.equal(review.snapshot.status, 'review');
    assert.equal(
      await markSpecificationReleased(calculation.id, review.snapshot.version),
      0,
      'review revision is never released',
    );
    const approved = await saveSpecification(
      calculation.id,
      { ...review.snapshot, status: 'confirmed' },
      'architect',
    );
    const rawBefore = await prisma.specificationVersion.findUniqueOrThrow({
      where: {
        calculationId_version: {
          calculationId: calculation.id,
          version: approved.snapshot.version,
        },
      },
    });
    assert.equal(await markSpecificationReleased(calculation.id, approved.snapshot.version), 1);
    assert.equal(
      await markSpecificationReleased(calculation.id, approved.snapshot.version),
      0,
      'release is idempotent',
    );
    const released = await loadSpecification(calculation.id, approved.snapshot.version);
    assert.equal(released?.snapshot.status, 'released');
    const rawAfter = await prisma.specificationVersion.findUniqueOrThrow({
      where: { id: rawBefore.id },
    });
    assert.equal(rawAfter.data, rawBefore.data, 'released revision data is immutable');
    assert.equal(
      (await loadSpecification(calculation.id, review.snapshot.version))?.snapshot.status,
      'review',
    );
    await assert.rejects(
      saveSpecification(calculation.id, released!.snapshot, 'architect'),
      (e: { statusCode?: number }) => e.statusCode === 400,
      'editors cannot assign released',
    );
    await assert.rejects(
      saveSpecification(
        calculation.id,
        { ...released!.snapshot, status: 'confirmed', emptySupplyReason: '' },
        'architect',
      ),
      (e: { statusCode?: number }) => e.statusCode === 409,
      'confirmation gate still applies',
    );
    const edition = await saveSpecification(
      calculation.id,
      { ...released!.snapshot, status: 'draft' },
      'presale',
    );
    assert.equal(edition.snapshot.version, approved.snapshot.version + 1);
    assert.equal(edition.snapshot.status, 'draft');
    assert.equal(
      (await loadSpecification(calculation.id, approved.snapshot.version))?.snapshot.status,
      'released',
      'new edition leaves the released revision untouched',
    );
    await prisma.calculation.delete({ where: { id: calculation.id } });
    assert.equal(
      await prisma.specificationVersion.count({ where: { calculationId: calculation.id } }),
      0,
      'FK cascade',
    );
    console.log(
      'Specification integration passed: serialized concurrent writes, stale 409, immutable historical revision, roundtrip, export gate, draft→review→confirmed→released lifecycle, cascade.',
    );
  } finally {
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
