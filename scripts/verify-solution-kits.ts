/** Библиотека решений (#103 WP-7a) на живой PostgreSQL: идемпотентный сид
 * встроенных наборов, неизменность утверждённой версии на уровне триггера
 * (правка содержимого, возврат в черновик, удаление — отказ; approved →
 * archived — можно), новая версия не меняет старую, CHECK и частичный
 * уникальный индекс одного черновика.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { builtinKits } from '../lib/solutionKits/builtin';
import { seedBuiltinSolutionKits } from '../lib/solutionKits/seed';
import {
  approveVersion,
  archiveVersion,
  createDraftVersion,
  createKit,
  diffKitVersion,
  getKitVersion,
  updateDraftVersion,
} from '../lib/solutionKits/store';

async function rejects(label: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
  } catch (e) {
    assert.match(String((e as Error).message ?? e), pattern, label);
    return;
  }
  assert.fail(`${label}: ожидался отказ СУБД`);
}

async function main() {
  // ── Сид: дважды подряд, второй раз ничего не создаёт ──────────────────
  const expected = builtinKits();
  const first = await seedBuiltinSolutionKits();
  const second = await seedBuiltinSolutionKits();
  assert.equal(second.created.length, 0, 'повторный сид ничего не создаёт');
  assert.equal(first.created.length + first.skipped.length, expected.length);
  const seeded = await prisma.solutionKit.findMany({
    where: { key: { in: expected.map((k) => k.key) } },
    include: { versions: true },
  });
  assert.equal(seeded.length, expected.length);
  for (const kit of seeded) {
    assert.equal(kit.status, 'approved', `${kit.key}: утверждён`);
    assert.equal(kit.versions.length, 1, `${kit.key}: одна версия`);
    assert.equal(kit.versions[0].status, 'approved');
    assert.equal(kit.versions[0].approvedBy, 'system');
  }
  const seededV1 = seeded[0].versions[0];
  await rejects(
    'триггер: системная v1 неизменна',
    () =>
      prisma.solutionKitVersion.update({
        where: { id: seededV1.id },
        data: { changelog: 'взлом' },
      }),
    /immutable/,
  );
  console.log(`[kits] сид идемпотентен: ${expected.length} встроенных наборов`);

  // ── Набор с владельцем: черновик → утверждение → новая версия ─────────
  const owner = await prisma.user.create({
    data: { username: `kit-owner-${randomUUID()}`, role: 'architect', passwordHash: 'x' },
  });
  const actor = { userId: owner.id, role: 'architect', username: owner.username };
  const created = await createKit(actor, {
    key: `ci.${randomUUID().slice(0, 8)}`,
    name: 'CI набор',
    content: {
      requirements: [
        { elementId: 'req-1', category: 'functional', title: 'A', description: 'Должна A.' },
      ],
      checks: [{ elementId: 'chk-1', requirementIds: ['req-1'], criteria: 'A видно' }],
    },
  });
  assert.ok(created.ok);
  const kitId = created.kit.id;
  const seen = async (version: number) =>
    (
      await prisma.solutionKitVersion.findUniqueOrThrow({
        where: { kitId_version: { kitId, version } },
      })
    ).updatedAt;
  const approved = await approveVersion(actor, kitId, 1, await seen(1));
  assert.ok(approved.ok, 'владелец-архитектор утверждает');
  const v1 = await prisma.solutionKitVersion.findUniqueOrThrow({
    where: { kitId_version: { kitId, version: 1 } },
  });

  await rejects(
    'триггер: правка содержимого утверждённой версии',
    () => prisma.solutionKitVersion.update({ where: { id: v1.id }, data: { content: { x: 1 } } }),
    /immutable/,
  );
  await rejects(
    'триггер: возврат в черновик',
    () =>
      prisma.solutionKitVersion.update({
        where: { id: v1.id },
        data: { status: 'draft', approvedBy: null, approvedAt: null },
      }),
    /immutable/,
  );
  await rejects(
    'триггер: архив с одновременной правкой содержимого',
    () =>
      prisma.solutionKitVersion.update({
        where: { id: v1.id },
        data: { status: 'archived', archivedAt: new Date(), content: { x: 1 } },
      }),
    /immutable/,
  );
  await rejects(
    'триггер: удаление утверждённой версии',
    () => prisma.solutionKitVersion.delete({ where: { id: v1.id } }),
    /only drafts/,
  );
  await rejects(
    'CHECK: утверждённая версия без подписи',
    () =>
      prisma.solutionKitVersion.create({
        data: { kitId, version: 99, status: 'approved', content: {}, createdBy: 'ci' },
      }),
    /SolutionKitVersion_approval_check/,
  );

  const draft = await createDraftVersion(actor, kitId);
  assert.ok(draft.ok);
  assert.equal(draft.version.version, 2);
  await rejects(
    'частичный уникальный индекс: второй черновик',
    () =>
      prisma.solutionKitVersion.create({
        data: { kitId, version: 3, content: {}, createdBy: 'ci' },
      }),
    /SolutionKitVersion_one_draft_key|Unique constraint/,
  );
  const v2 = await getKitVersion(kitId, 2);
  assert.ok(v2);
  const next = structuredClone(v2.content);
  next.requirements[0].title = 'A и B';
  const viewed = await seen(2);
  assert.ok((await updateDraftVersion(actor, kitId, 2, { content: next, changelog: 'B' })).ok);
  const stale = await approveVersion(actor, kitId, 2, viewed);
  assert.ok(!stale.ok && stale.status === 409, 'черновик изменён после просмотра — 409');
  assert.ok((await approveVersion(actor, kitId, 2, await seen(2))).ok);

  const v1After = await prisma.solutionKitVersion.findUniqueOrThrow({ where: { id: v1.id } });
  assert.deepEqual(v1After.content, v1.content, 'новая версия не меняет старую');
  assert.equal(v1After.status, 'approved');
  const diff = await diffKitVersion(kitId, 2);
  assert.ok(diff.ok);
  assert.deepEqual(diff.diff.sections.requirements.changed[0].fields, ['title']);

  // ── approved → archived разрешён триггером; дальше архив неизменен ────
  assert.ok((await archiveVersion(actor, kitId, 1)).ok);
  const archived = await prisma.solutionKitVersion.findUniqueOrThrow({ where: { id: v1.id } });
  assert.equal(archived.status, 'archived');
  assert.deepEqual(archived.content, v1.content);
  await rejects(
    'триггер: архивная версия неизменна',
    () => prisma.solutionKitVersion.update({ where: { id: v1.id }, data: { status: 'approved' } }),
    /immutable/,
  );
  // Архив последней утверждённой версии возвращает набор в черновик.
  const last = await archiveVersion(actor, kitId, 2);
  assert.ok(last.ok && last.kitStatus === 'draft');
  const kitAfter = await prisma.solutionKit.findUniqueOrThrow({ where: { id: kitId } });
  assert.equal(kitAfter.status, 'draft');
  console.log('[kits] утверждённые версии неизменны, новая версия не трогает старую');
}

main()
  .then(() => console.log('[kits] OK'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
