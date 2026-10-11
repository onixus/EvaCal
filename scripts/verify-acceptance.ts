/** Acceptance checks, results and remarks (#103 WP-4a) against the isolated CI database. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { loadStoredFile, setArtifactBackend } from '../lib/gost34/storage';
import { evidenceKeyPrefix, validateResultInput } from '../lib/acceptance/rules';
import { validateDecisionInput } from '../lib/acceptance/decision';
import {
  AcceptanceSourceError,
  decisionInputs,
  loadAcceptanceFacts,
  loadDecisionState,
  recordDecision,
} from '../lib/acceptance/decisionStore';
import { prepareGost34Document } from '../lib/gost34/generation/prepareDocument';
import {
  cleanupOrphanEvidence,
  countPendingSeeds,
  deleteEvidence,
  editRemarkText,
  findEvidence,
  listChecks,
  listChecksWithFlags,
  recordResult,
  seedChecks,
  transitionRemark,
  uploadEvidence,
} from '../lib/acceptance/store';

const constraint = /constraint|unique|violat|check/i;

function decisionGapLabel(gaps: { path: string; label: string }[]) {
  return gaps.find((g) => g.path === 'acceptance.decision')?.label;
}

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

    // Вложение: загрузчик, время и имя фиксирует сервер; ссылка — по id.
    const upload = (name: string, by = 'u-architect') =>
      uploadEvidence({
        packageId: pkg.id,
        checkId: c1.id,
        fileName: name,
        ext: 'pdf',
        mime: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 evidence'),
        uploadedBy: by === 'u-architect' ? 'architect' : 'gap',
        uploadedById: by,
      });
    const ref = await upload('../../etc/протокол <1>.pdf');
    assert.ok(ref.key.startsWith(evidenceKeyPrefix(pkg.id, c1.id)));
    assert.equal(ref.name, 'протокол 1.pdf', 'name is sanitized');
    assert.equal(ref.uploadedBy, 'architect');
    await assert.rejects(
      prisma.acceptanceEvidence.create({
        data: {
          ...ref,
          id: undefined,
          key: `${ref.key}.dup`,
          checkId: c1.id,
          size: 0,
          uploadedById: 'x',
          uploadedAt: new Date(),
        },
      }),
      constraint,
      'empty evidence is rejected by CHECK',
    );

    // ✕ в форме: неприкреплённое удаляет загрузчик или админ, чужой — нет.
    const scratch = await upload('черновик.pdf');
    const denied = await deleteEvidence({
      checkId: c1.id,
      evidenceId: scratch.id,
      actor: { id: 'u-gap', role: 'gap' },
    });
    assert.equal(!denied.ok && denied.status, 403);
    const removed = await deleteEvidence({
      checkId: c1.id,
      evidenceId: scratch.id,
      actor: { id: 'u-architect', role: 'architect' },
    });
    assert.ok(removed.ok);
    assert.equal(await loadStoredFile(scratch.key), null, 'orphan file removed from storage');

    // Брошенная загрузка старше суток удаляется при следующей загрузке к проверке.
    const stale = await upload('брошено.pdf');
    await prisma.acceptanceEvidence.update({
      where: { id: stale.id },
      data: { uploadedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
    });
    const fresh = await upload('свежее.pdf');
    assert.equal(await prisma.acceptanceEvidence.count({ where: { id: stale.id } }), 0);
    assert.equal(await loadStoredFile(stale.key), null);
    assert.equal(await cleanupOrphanEvidence(c1.id), 0, 'fresh upload is kept');

    // Чужое или несуществующее вложение не прикрепляется; транзакция откатывается.
    const badAttach = await recordResult({
      checkId: checks[1].id,
      result: valid({ status: 'blocked', actualResult: 'Нет стенда' }),
      executorId: null,
      evidenceIds: [ref.id],
      recordedBy: 'architect',
      recordedById: 'u-architect',
    });
    assert.equal(badAttach.ok, false, 'evidence of another check is rejected');
    assert.equal(await prisma.acceptanceResult.count({ where: { checkId: checks[1].id } }), 0);

    // Провал с замечанием → повторная проверка → последний результат побеждает.
    const failedRes = await recordResult({
      checkId: c1.id,
      result: valid({
        status: 'failed',
        executorName: 'Иванов',
        executedAt: '2026-10-01T10:00:00Z',
        actualResult: 'Отчёт за 12 с',
      }),
      executorId: null,
      evidenceIds: [ref.id],
      recordedBy: 'architect',
      recordedById: 'u-architect',
      remarkText: 'Время формирования превышает критерий',
    });
    assert.ok(failedRes.ok);
    const failed = failedRes.value;
    assert.ok(failed.remark);
    assert.equal(failed.result.evidence[0].uploadedBy, 'architect', 'uploader from upload time');
    checks = await listChecks(pkg.id);
    assert.equal(checks[0].status, 'failed');
    assert.equal(checks[0].openRemarks, 1);
    assert.equal(checks[0].latest?.evidence.length, 1);
    assert.ok(await findEvidence(c1.id, ref.key), 'attached evidence is downloadable');
    assert.equal(await findEvidence(c1.id, fresh.key), null, 'unattached is not downloadable');
    assert.equal(await findEvidence(checks[1].id, ref.key), null, 'not via another check');
    const reattach = await recordResult({
      checkId: c1.id,
      result: valid({ status: 'not_run' }),
      executorId: null,
      evidenceIds: [ref.id],
      recordedBy: 'architect',
      recordedById: 'u-architect',
    });
    assert.equal(reattach.ok, false, 'evidence is attached once');
    const attachedDelete = await deleteEvidence({
      checkId: c1.id,
      evidenceId: ref.id,
      actor: { id: 'u-architect', role: 'admin' },
    });
    assert.equal(!attachedDelete.ok && attachedDelete.status, 409);

    // Журнал неизменяем: UPDATE запрещён триггером.
    await assert.rejects(
      prisma.acceptanceResult.update({
        where: { id: failed.result.id },
        data: { status: 'passed' },
      }),
      /append-only/,
    );

    const remarkId = failed.remark!.id;
    // Правка текста: только автор или админ, прежний текст в журнале правок.
    const foreignEdit = await editRemarkText({
      checkId: c1.id,
      remarkId,
      text: 'Чужая правка',
      actor: { id: 'u-gap', name: 'gap', role: 'gap' },
    });
    assert.equal(!foreignEdit.ok && foreignEdit.status, 403);
    const edit = await editRemarkText({
      checkId: c1.id,
      remarkId,
      text: 'Отчёт формируется дольше 5 с',
      actor: { id: 'u-architect', name: 'architect', role: 'architect' },
    });
    assert.ok(edit.ok);
    assert.equal(edit.value.previousText, 'Время формирования превышает критерий');
    assert.deepEqual(
      edit.value.remark.edits.map((e) => [e.previousText, e.newText, e.editedBy]),
      [['Время формирования превышает критерий', 'Отчёт формируется дольше 5 с', 'architect']],
    );

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
    const retestRes = await recordResult({
      checkId: c1.id,
      result: valid({
        status: 'passed',
        executorName: 'Петров',
        executedAt: '2026-10-02T10:00:00Z',
        actualResult: 'Отчёт за 3 с',
      }),
      executorId: null,
      evidenceIds: [fresh.id],
      recordedBy: 'gap',
      recordedById: 'u-gap',
    });
    assert.ok(retestRes.ok);
    const retest = retestRes.value;
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

    // ===== WP-4b: факты для ПСИ, пересмотр по запросу на изменение, решение комиссии.
    let facts = await loadAcceptanceFacts({ calculationId: calc.id });
    assert.equal(facts?.packageId, pkg.id, 'latest approved edition with checks is used');
    assert.deepEqual(
      facts?.checks.map((c) => [c.requirementCode, c.status]),
      [
        ['ТР-Ф-01', 'passed'],
        ['ТР-Ф-02', 'not_run'],
      ],
    );
    assert.equal(facts?.decision, null);
    const psi = prepareGost34Document({
      calculation: { name: 'Приёмка', customer: 'CI' },
      acceptance: facts,
      metadataOverride: { docType: 'PSI' },
    });
    const psiRows = psi.ast.sections.find((s) => s.id === 'sec-3')!.tables![0].rows;
    assert.deepEqual(
      psiRows.map((r) => r[5]),
      ['Пройдена', 'Не проводилась'],
      'PSI table is filled from facts',
    );
    assert.ok(psi.diagnostics.gaps.some((g) => g.path === 'acceptance.decision'));
    await assert.rejects(
      loadAcceptanceFacts({ calculationId: 'other-calc', packageId: pkg.id }),
      AcceptanceSourceError,
    );

    // Запрос на изменение «на оценке» по r2 помечает проверку к пересмотру.
    await prisma.changeRequest.create({
      data: {
        projectId: project.id,
        seq: 1,
        title: 'Изменить вход',
        initiator: 'Заказчик',
        reason: 'Новый провайдер SSO',
        status: 'submitted',
        baseCalculationId: calc.id,
        basePackageId: pkg.id,
        affectedRequirements: [{ id: 'r2', code: 'ТР-Ф-02', text: 'Вход' }],
        createdBy: 'architect',
      },
    });
    const flagged = await listChecksWithFlags(pkg);
    assert.deepEqual(
      flagged.map((c) => c.needsReview.map((f) => f.label)),
      [[], ['ЗИ-01']],
      'check of the affected requirement needs review',
    );

    const inputs = decisionInputs(flagged);
    const commission = [{ name: 'Петров П.П.', position: 'Председатель' }];
    const acceptedRule = validateDecisionInput(
      { decision: 'accepted', commission, basis: 'Протокол №1' },
      inputs,
    );
    assert.equal(acceptedRule.ok, false, 'accepted is impossible with a not-run check');
    const withRemarks = validateDecisionInput(
      {
        decision: 'accepted_with_remarks',
        commission,
        basis: 'Протокол №1',
        exceptions: [{ checkId: flagged[1].id, note: 'провести после изменения SSO' }],
      },
      inputs,
    );
    assert.ok(withRemarks.ok);
    const decision = await recordDecision({
      packageId: pkg.id,
      value: withRemarks.value,
      decidedBy: 'gap',
      decidedById: 'u-gap',
    });
    let state = await loadDecisionState(pkg.id, flagged);
    assert.equal(state.current?.id, decision.id);
    assert.equal(state.stale, false);
    facts = await loadAcceptanceFacts({ calculationId: calc.id });
    assert.equal(facts?.decision?.decision, 'accepted_with_remarks');
    const act = prepareGost34Document({
      calculation: { name: 'Приёмка', customer: 'CI' },
      acceptance: facts,
      metadataOverride: { docType: 'ACT' },
    });
    const actText = act.ast.sections.flatMap((s) => s.paragraphs).join('\n');
    assert.ok(actText.includes('принять с замечаниями'), 'ACT conclusion from the decision');
    assert.ok(actText.includes('ТР-Ф-02 — провести после изменения SSO'));

    // CHECK и неизменяемость решений.
    const decisionBase = {
      packageId: pkg.id,
      basis: 'x',
      checksSnapshot: [{ checkId: c1.id }],
      decidedBy: 'x',
      decidedById: 'x',
    };
    for (const data of [
      { ...decisionBase, decision: 'accepted_with_remarks', commission, exceptions: [] },
      { ...decisionBase, decision: 'accepted', commission, exceptions: [{ checkId: c1.id }] },
      { ...decisionBase, decision: 'rejected', commission: [] },
      { ...decisionBase, decision: 'rejected', commission, basis: ' ' },
      { ...decisionBase, decision: 'maybe', commission },
    ]) {
      await assert.rejects(
        prisma.acceptanceDecision.create({ data: data as never }),
        constraint,
        JSON.stringify(data),
      );
    }
    await assert.rejects(
      prisma.acceptanceDecision.update({ where: { id: decision.id }, data: { basis: 'другое' } }),
      /append-only/,
    );

    // Новый результат после решения делает его устаревшим: в акт оно не попадает.
    await new Promise((r) => setTimeout(r, 5));
    const late = await recordResult({
      checkId: flagged[1].id,
      result: valid({
        status: 'passed',
        executorName: 'Петров',
        executedAt: new Date().toISOString(),
        actualResult: 'Вход через новый SSO',
      }),
      executorId: null,
      evidenceIds: [],
      recordedBy: 'gap',
      recordedById: 'u-gap',
    });
    assert.ok(late.ok);
    state = await loadDecisionState(pkg.id, await listChecksWithFlags(pkg));
    assert.equal(state.current, null);
    assert.equal(state.stale, true);
    facts = await loadAcceptanceFacts({ calculationId: calc.id });
    assert.equal(facts?.decision, null);
    assert.equal(facts?.decisionStale, true);
    assert.equal(
      decisionGapLabel(
        prepareGost34Document({
          calculation: { name: 'Приёмка', customer: 'CI' },
          acceptance: facts,
          metadataOverride: { docType: 'ACT' },
        }).diagnostics.gaps,
      ),
      'Решение комиссии устарело',
    );
    checks = await listChecks(pkg.id);

    // Каскад: удаление комплекта удаляет проверки и решения, несмотря на запрет UPDATE.
    await prisma.gostPackage.delete({ where: { id: pkg.id } });
    assert.equal(await prisma.acceptanceCheck.count({ where: { packageId: pkg.id } }), 0);
    assert.equal(await prisma.acceptanceResult.count({ where: { checkId: c1.id } }), 0);
    assert.equal(await prisma.acceptanceDecision.count({ where: { packageId: pkg.id } }), 0);

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
