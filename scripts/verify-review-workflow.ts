/** Review assignments and comment lifecycle (#103 WP-3a) against the isolated CI database. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { GostReviewConflictError, reviewGostPackage } from '../lib/project';
import {
  assignReviewStage,
  countOpenBlockers,
  loadActiveAssignments,
  loadReviewComments,
  summarizeReviewBulk,
} from '../lib/review/store';

const constraint = /constraint|unique|violat/i;

async function main() {
  const tag = randomUUID().slice(0, 8);
  const template = await prisma.formTemplate.create({ data: { name: `review-${tag}` } });
  const project = await prisma.project.create({
    data: { name: 'Review workflow integration', customer: 'CI' },
  });
  const [tw, gap, gapDeputy] = await Promise.all(
    (['techwriter', 'gap', 'gap'] as const).map((role, i) =>
      prisma.user.create({
        data: { username: `review-${tag}-${role}-${i}`, role, passwordHash: 'x' },
      }),
    ),
  );
  try {
    const calc = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'Ревью',
        customer: 'CI',
        answers: '{}',
      },
    });
    const base = {
      calculationId: calc.id,
      projectId: project.id,
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '1',
      generatorVersion: '1',
      documentTypes: '["tz"]',
    };
    const v1 = await prisma.gostPackage.create({
      data: { ...base, name: 'v1', version: 1, status: 'rejected', reviewStage: 'gap' },
    });
    const v2 = await prisma.gostPackage.create({
      data: { ...base, name: 'v2', version: 2, status: 'under_review', reviewStage: 'gap' },
    });

    // Блокер к v1 переходит в v2 и блокирует утверждение, пока не проверен.
    const blocker = await prisma.reviewComment.create({
      data: {
        packageId: v1.id,
        stage: 'gap',
        sectionId: '4.1',
        severity: 'blocker',
        text: 'Противоречие таблице требований',
        author: gap.username,
        authorId: gap.id,
      },
    });
    await prisma.reviewCommentReply.create({
      data: { commentId: blocker.id, text: 'Исправим в v2', author: 'architect' },
    });
    assert.equal(await countOpenBlockers(v2), 1, 'open v1 blocker carries over to v2');
    const carried = await loadReviewComments(v2);
    assert.equal(carried.length, 1);
    assert.equal(carried[0].packageVersion, 1);
    assert.equal(carried[0].replies?.length, 1);

    await assert.rejects(
      prisma.reviewComment.update({ where: { id: blocker.id }, data: { status: 'fixed' } }),
      constraint,
      'fixed requires a fixed-in package reference',
    );
    await assert.rejects(
      prisma.reviewComment.update({ where: { id: blocker.id }, data: { status: 'closed' } }),
      constraint,
      'status enum is enforced by CHECK',
    );

    await prisma.reviewComment.update({
      where: { id: blocker.id },
      data: {
        status: 'fixed',
        fixedBy: 'architect',
        fixedAt: new Date(),
        fixedInPackageId: v2.id,
        fixedInVersion: v2.version,
      },
    });
    assert.equal(await countOpenBlockers(v2), 1, 'fixed but unverified blocker still blocks');
    assert.equal((await summarizeReviewBulk([v1, v2])).get(v2.id)?.openBlockers, 1);
    await assert.rejects(
      reviewGostPackage({ packageId: v2.id, decision: 'approve', actorId: gap.id }),
      (err: unknown) => err instanceof GostReviewConflictError,
    );

    await assert.rejects(
      prisma.reviewComment.update({ where: { id: blocker.id }, data: { status: 'verified' } }),
      constraint,
      'verified requires verifier',
    );
    await prisma.reviewComment.update({
      where: { id: blocker.id },
      data: { status: 'verified', verifiedBy: gap.username, verifiedAt: new Date() },
    });
    assert.equal(await countOpenBlockers(v2), 0);
    assert.equal(
      (await loadReviewComments(v2)).length,
      1,
      'comment fixed in v2 stays visible there after verification',
    );

    // Назначения: одно активное на этап, переназначение снимает прежнее.
    const due = new Date(Date.now() + 3 * 86_400_000);
    await assignReviewStage({
      packageId: v2.id,
      stage: 'gap',
      assigneeId: gap.id,
      deputyId: null,
      dueAt: due,
      assignedBy: 'ci',
    });
    const second = await assignReviewStage({
      packageId: v2.id,
      stage: 'gap',
      assigneeId: gapDeputy.id,
      deputyId: gap.id,
      dueAt: due,
      assignedBy: 'ci',
    });
    const active = await loadActiveAssignments([v2.id]);
    assert.equal(active.get(`${v2.id}:gap`)?.id, second.id);
    assert.equal(active.get(`${v2.id}:gap`)?.deputyName, gap.username);
    assert.equal(await prisma.reviewAssignment.count({ where: { packageId: v2.id } }), 2);
    await assert.rejects(
      prisma.reviewAssignment.create({
        data: { packageId: v2.id, stage: 'gap', assigneeId: gap.id, dueAt: due, assignedBy: 'ci' },
      }),
      constraint,
      'partial unique index allows one active assignment per stage',
    );
    await assert.rejects(
      prisma.reviewAssignment.create({
        data: {
          packageId: v2.id,
          stage: 'tw',
          assigneeId: tw.id,
          deputyId: tw.id,
          dueAt: due,
          assignedBy: 'ci',
        },
      }),
      constraint,
      'deputy differs from assignee',
    );

    // Назначение не обходит гейт роли — это проверяет маршрут; здесь —
    // что утверждение после проверки блокера проходит.
    const approved = await reviewGostPackage({
      packageId: v2.id,
      decision: 'approve',
      actorId: gap.id,
    });
    assert.equal(approved.status, 'approved');

    // Резерв: комплект без строк замечаний читает старый JSON-столбец.
    const legacy = await prisma.gostPackage.create({
      data: {
        ...base,
        projectId: null,
        name: 'legacy',
        version: 1,
        status: 'under_review',
        reviewComments: JSON.stringify([
          { id: 'c1', sectionId: '1', severity: 'blocker', text: 't', author: 'r', createdAt: '' },
        ]),
      },
    });
    const legacyComments = await loadReviewComments(legacy);
    assert.equal(legacyComments.length, 1);
    assert.equal(legacyComments[0].legacy, true);
    assert.equal(await countOpenBlockers(legacy), 1);

    // Удаление комплекта каскадно убирает его замечания, ответы и назначения.
    await prisma.gostPackage.delete({ where: { id: v1.id } });
    assert.equal(await prisma.reviewComment.count({ where: { id: blocker.id } }), 0);
    assert.equal(await prisma.reviewCommentReply.count({ where: { commentId: blocker.id } }), 0);

    console.log(
      'Review workflow integration passed: carried-over blockers, fixed-unverified blocks approval, status CHECKs, one active assignment per stage, deputy check, JSON fallback, cascades.',
    );
  } finally {
    await prisma.gostPackage.deleteMany({ where: { calculation: { templateId: template.id } } });
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
    await prisma.user.deleteMany({ where: { id: { in: [tw.id, gap.id, gapDeputy.id] } } });
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
