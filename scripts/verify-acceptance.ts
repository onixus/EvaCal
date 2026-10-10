/** Acceptance checks, results and remarks (#103 WP-4a) against the isolated CI database. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { setArtifactBackend } from '../lib/gost34/storage';
import { evidenceKeyPrefix, validateResultInput } from '../lib/acceptance/rules';
import {
  countPendingSeeds,
  findEvidence,
  listChecks,
  recordResult,
  resolveEvidence,
  seedChecks,
  transitionRemark,
  uploadEvidence,
} from '../lib/acceptance/store';

const constraint = /constraint|unique|violat|check/i;

function valid(input: Parameters<typeof validateResultInput>[0]) {
  const r = validateResultInput(input);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

async function main() {
  const tag = randomUUID().slice(0, 8);
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evacal-acceptance-'));
  process.env.GOST_PACKAGE_STORAGE = 'fs';
  process.env.GOST_PACKAGE_STORAGE_PATH = storageDir;
  setArtifactBackend(null);

  const template = await prisma.formTemplate.create({ data: { name: `acceptance-${tag}` } });
  const project = await prisma.project.create({
    data: { name: 'Acceptance integration', customer: 'CI' },
  });
  try {
    const calc = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'Приёмка',
        customer: 'CI',
        answers: '{}',
      },
    });
    const snapshot = JSON.stringify({
      requirements: [
        { id: 'r1', code: 'ТР-Ф-01', title: 'Отчёт', criterion: 'Формируется за 5 с' },
        {
          id: 'r2',
          code: 'ТР-Ф-02',
          title: 'Вход',
          acceptanceCriteria: ['Вход по SSO'],
          verificationMethod: 'DEMONSTRATION',
        },
        { id: 'r3', code: 'ТР-Ф-03', title: 'Без критерия' },
      ],
    });
    const pkg = await prisma.gostPackage.create({
      data: {
        calculationId: calc.id,
        projectId: project.id,
        name: 'v1',
        version: 1,
        status: 'approved',
        reviewStage: 'done',
        standardProfileId: 'ru-gost34-current',
        standardProfileVersion: '1',
        generatorVersion: '1',
        documentTypes: '["tz","pmi"]',
        snapshot,
      },
    });

    // Засев идемпотентен и берёт только требования с критерием/методом.
    assert.equal(await countPendingSeeds(pkg), 2);
    assert.deepEqual(await seedChecks(pkg, 'architect'), { created: 2, total: 2 });
    assert.deepEqual(await seedChecks(pkg, 'architect'), { created: 0, total: 2 });
    assert.equal(await countPendingSeeds(pkg), 0);
    let checks = await listChecks(pkg.id);
    assert.deepEqual(
      checks.map((c) => [c.requirementCode, c.status, c.method]),
      [
        ['ТР-Ф-01', 'not_run', null],
        ['ТР-Ф-02', 'not_run', 'DEMONSTRATION'],
      ],
      'no result means not_run, never passed',
    );
    await assert.rejects(
      prisma.acceptanceCheck.create({
        data: {
          packageId: pkg.id,
          calculationId: calc.id,
          requirementId: 'r1',
          requirementCode: 'dup',
          title: 'dup',
          criteria: [],
          order: 9,
          createdBy: 'x',
        },
      }),
      constraint,
      'one check per requirement per edition',
    );
    const [c1] = checks;

    // CHECK: «пройдена» без исполнителя / даты / результата не записывается.
    for (const data of [
      { status: 'passed', executedAt: new Date(), actualResult: 'ok' },
      { status: 'passed', executorName: 'Иванов', actualResult: 'ok' },
      { status: 'failed', executorName: 'Иванов', executedAt: new Date(), actualResult: ' ' },
      { status: 'passed_by_default' },
    ]) {
      await assert.rejects(
        prisma.acceptanceResult.create({ data: { checkId: c1.id, recordedBy: 'ci', ...data } }),
        constraint,
        JSON.stringify(data),
      );
    }

    // Вложение: загрузка в хранилище, сервер сверяет файл и контрольную сумму.
    const ref = await uploadEvidence({
      packageId: pkg.id,
      checkId: c1.id,
      fileName: 'протокол.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 evidence'),
      uploadedBy: 'architect',
    });
    assert.ok(ref.key.startsWith(evidenceKeyPrefix(pkg.id, c1.id)));
    const resolved = await resolveEvidence([{ ...ref, size: 1, checksum: 'forged' }]);
    assert.ok(resolved.ok);
    assert.equal(resolved.value[0].checksum, ref.checksum, 'checksum comes from the stored file');
    const missing = await resolveEvidence([
      { ...ref, key: `${evidenceKeyPrefix(pkg.id, c1.id)}x.pdf` },
    ]);
    assert.equal(missing.ok, false, 'unknown evidence key is rejected');

    // Провал с замечанием → повторная проверка → последний результат побеждает.
    const failed = await recordResult({
      checkId: c1.id,
      result: valid({
        status: 'failed',
        executorName: 'Иванов',
        executedAt: '2026-10-01T10:00:00Z',
        actualResult: 'Отчёт за 12 с',
      }),
      executorId: null,
      evidence: resolved.value,
      recordedBy: 'architect',
      remarkText: 'Время формирования превышает критерий',
    });
    assert.ok(failed.remark);
    checks = await listChecks(pkg.id);
    assert.equal(checks[0].status, 'failed');
    assert.equal(checks[0].openRemarks, 1);
    assert.equal(checks[0].latest?.evidence.length, 1);
    assert.ok(await findEvidence(c1.id, ref.key), 'attached evidence is downloadable');
    assert.equal(await findEvidence(checks[1].id, ref.key), null, 'not via another check');

    // Журнал неизменяем: UPDATE запрещён триггером.
    await assert.rejects(
      prisma.acceptanceResult.update({
        where: { id: failed.result.id },
        data: { status: 'passed' },
      }),
      /append-only/,
    );

    const remarkId = failed.remark!.id;
    // Снять замечание без повторной проверки нельзя (правило и CHECK).
    const early = await transitionRemark({
      checkId: c1.id,
      remarkId,
      action: 'verify',
      retestResultId: failed.result.id,
      actor: 'gap',
    });
    assert.equal(early.ok, false);
    await assert.rejects(
      prisma.acceptanceRemark.update({
        where: { id: remarkId },
        data: { status: 'verified', resolvedBy: 'x', resolvedAt: new Date() },
      }),
      constraint,
      'verified requires retest reference',
    );
    const resolvedRemark = await transitionRemark({
      checkId: c1.id,
      remarkId,
      action: 'resolve',
      actor: 'architect',
    });
    assert.ok(resolvedRemark.ok && resolvedRemark.value.status === 'resolved');

    await new Promise((r) => setTimeout(r, 5));
    const retest = await recordResult({
      checkId: c1.id,
      result: valid({
        status: 'passed',
        executorName: 'Петров',
        executedAt: '2026-10-02T10:00:00Z',
        actualResult: 'Отчёт за 3 с',
      }),
      executorId: null,
      evidence: [],
      recordedBy: 'gap',
    });
    const verified = await transitionRemark({
      checkId: c1.id,
      remarkId,
      action: 'verify',
      retestResultId: retest.result.id,
      actor: 'gap',
    });
    assert.ok(verified.ok && verified.value.status === 'verified');
    const again = await transitionRemark({
      checkId: c1.id,
      remarkId,
      action: 'reopen',
      actor: 'x',
    });
    assert.equal(again.ok, false, 'verified remark is final');

    checks = await listChecks(pkg.id);
    assert.equal(checks[0].status, 'passed', 'latest result wins');
    assert.deepEqual(
      checks[0].history.map((h) => h.status),
      ['passed', 'failed'],
      'history is kept, newest first',
    );
    assert.equal(checks[0].openRemarks, 0);
    assert.equal(checks[1].status, 'not_run');

    // Каскад: удаление комплекта удаляет проверки, несмотря на запрет UPDATE.
    await prisma.gostPackage.delete({ where: { id: pkg.id } });
    assert.equal(await prisma.acceptanceCheck.count({ where: { packageId: pkg.id } }), 0);
    assert.equal(await prisma.acceptanceResult.count({ where: { checkId: c1.id } }), 0);

    console.log('[verify-acceptance] OK');
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.formTemplate.delete({ where: { id: template.id } }).catch(() => undefined);
    await fs.rm(storageDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
