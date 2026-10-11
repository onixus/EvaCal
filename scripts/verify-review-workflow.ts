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
import {
  markNotificationsRead,
  saveNotifications,
  syncOverdueNotifications,
} from '../lib/review/notifications';
import { loadMyQueue } from '../lib/review/queue';
import { actorFromSession } from '../lib/review/workflow';

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
      (err: unknown) => (err as { code?: string }).code === 'P2002',
      'partial unique index allows one active assignment per stage (P2002 → 409 in the route)',
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

    // Репро ревью PR: v1 отклонён с блокером, v2 утверждён, v3 на ревью —
    // утверждённая v2 служит барьером, блокер v1 до v3 не доходит.
    await prisma.reviewComment.create({
      data: {
        packageId: v1.id,
        stage: 'gap',
        sectionId: '5',
        severity: 'blocker',
        text: 'Исторический блокер до утверждённой версии',
        author: gap.username,
        authorId: gap.id,
      },
    });
    const v3 = await prisma.gostPackage.create({
      data: { ...base, name: 'v3', version: 3, status: 'under_review', reviewStage: 'tw' },
    });
    assert.equal(await countOpenBlockers(v3), 0, 'approved v2 is a carry-forward barrier');
    assert.equal(await countOpenBlockers(v1), 1, 'blocker still counts for its own package');

    // Перенесённые миграцией (legacy) замечания не переходят в новые версии;
    // другой состав документов и архивные версии — не та линия переноса.
    const calc2 = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'Ревью 2',
        customer: 'CI',
        answers: '{}',
      },
    });
    const line2 = { ...base, calculationId: calc2.id };
    const w1 = await prisma.gostPackage.create({
      data: { ...line2, name: 'w1', version: 1, status: 'rejected', reviewStage: 'gap' },
    });
    const w2 = await prisma.gostPackage.create({
      data: { ...line2, name: 'w2', version: 2, status: 'archived', reviewStage: 'gap' },
    });
    const otherDocs = await prisma.gostPackage.create({
      data: {
        ...line2,
        documentTypes: '["pmi"]',
        name: 'pmi',
        version: 3,
        status: 'rejected',
        reviewStage: 'tw',
      },
    });
    const w4 = await prisma.gostPackage.create({
      data: { ...line2, name: 'w4', version: 4, status: 'under_review', reviewStage: 'tw' },
    });
    const blockerOn = (packageId: string, legacy: boolean) =>
      prisma.reviewComment.create({
        data: {
          packageId,
          stage: 'tw',
          sectionId: '1',
          severity: 'blocker',
          text: 'b',
          author: 'reviewer',
          legacy,
        },
      });
    await blockerOn(w1.id, true);
    await blockerOn(w2.id, false);
    await blockerOn(otherDocs.id, false);
    assert.equal(
      await countOpenBlockers(w4),
      0,
      'legacy, archived and other-docs blockers stay put',
    );
    assert.equal(await countOpenBlockers(w1), 1, 'legacy blocker counts for its own package');
    await blockerOn(w1.id, false);
    assert.equal(await countOpenBlockers(w4), 1, 'regular open blocker of w1 carries to w4');
    assert.equal((await summarizeReviewBulk([w1, w2, otherDocs, w4])).get(w4.id)?.openBlockers, 1);

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

    // #103 WP-3b: просрочка дописывается лениво и идемпотентно.
    const pastDue = new Date(Date.now() - 86_400_000);
    const overdueAssignment = await assignReviewStage({
      packageId: w4.id,
      stage: 'tw',
      assigneeId: tw.id,
      deputyId: null,
      dueAt: pastDue,
      assignedBy: gap.id,
    });
    assert.equal(await syncOverdueNotifications(tw.id), 1, 'first read creates overdue');
    assert.equal(await syncOverdueNotifications(tw.id), 0, 'second read is idempotent');
    assert.equal(
      await prisma.notification.count({
        where: { userId: tw.id, kind: 'overdue', entityId: overdueAssignment.id },
      }),
      1,
    );
    const twActor = actorFromSession({ userId: tw.id, username: tw.username, role: tw.role });
    const twQueue = await loadMyQueue(twActor);
    assert.equal(twQueue.overdue, 1, 'overdue assignment is on top of the queue');
    assert.equal(twQueue.items[0].packageId, w4.id);
    assert.equal(twQueue.unread, 1);
    assert.equal(twQueue.badge, 1, 'task and its overdue notification count once');
    assert.equal(
      await prisma.notification.count({ where: { userId: tw.id } }),
      1,
      'reading the queue again does not duplicate overdue',
    );

    // Уникальность (user, kind, entity, dueAt) на уровне БД; у прочих видов
    // dueAt пуст — повторные ответы в одной ветке не схлопываются.
    await assert.rejects(
      prisma.notification.create({
        data: {
          userId: tw.id,
          kind: 'overdue',
          entityType: 'review_assignment',
          entityId: overdueAssignment.id,
          dueAt: pastDue,
        },
      }),
      (err: unknown) => (err as { code?: string }).code === 'P2002',
    );
    await assert.rejects(
      prisma.notification.create({
        data: { userId: tw.id, kind: 'overdue', entityType: 'review_assignment', entityId: 'x' },
      }),
      constraint,
      'overdue requires dueAt',
    );
    await assert.rejects(
      prisma.notification.create({
        data: { userId: tw.id, kind: 'spam', entityType: 'gost_package', entityId: 'x' },
      }),
      constraint,
      'kind enum is enforced by CHECK',
    );
    const reply = {
      userId: gap.id,
      kind: 'comment_reply' as const,
      entityType: 'review_comment' as const,
      entityId: 'rc-ci',
      payload: { packageId: w4.id },
    };
    assert.equal(await saveNotifications([reply, reply]), 2, 'replies are not deduplicated');
    assert.equal(
      await saveNotifications([{ ...reply, userId: 'not-a-user' }]),
      0,
      'unknown recipients are skipped',
    );

    // Прочитать: только свои.
    assert.equal(await markNotificationsRead(gap.id, 'all'), 2);
    const twNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: tw.id },
    });
    assert.equal(await markNotificationsRead(gap.id, [twNotification.id]), 0, 'not own');
    assert.equal(await markNotificationsRead(tw.id, [twNotification.id]), 1);
    assert.equal((await loadMyQueue(twActor)).unread, 0);

    // Возвращённый комплект автора — в его очереди, пока не заменён.
    const calc3 = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'Ревью 3',
        customer: 'CI',
        answers: '{}',
      },
    });
    const line3 = { ...base, calculationId: calc3.id, documentTypes: '["tz","pmi"]' };
    const r1 = await prisma.gostPackage.create({
      data: {
        ...line3,
        name: 'r1',
        version: 1,
        status: 'rejected',
        reviewStage: 'tw',
        releasedBy: gapDeputy.id,
        reviewComment: 'Нет ПМИ',
      },
    });
    const deputyActor = actorFromSession({
      userId: gapDeputy.id,
      username: gapDeputy.username,
      role: gapDeputy.role,
    });
    assert.ok(
      (await loadMyQueue(deputyActor)).items.some(
        (i) => i.kind === 'returned' && i.packageId === r1.id,
      ),
      'returned package is in the author queue',
    );
    // Тот же состав в другом порядке — та же линия: замечание переходит, а
    // возврат заменён новой версией.
    await blockerOn(r1.id, false);
    const r2 = await prisma.gostPackage.create({
      data: {
        ...line3,
        documentTypes: '["pmi","tz"]',
        name: 'r2',
        version: 2,
        status: 'under_review',
        reviewStage: 'tw',
      },
    });
    assert.equal(await countOpenBlockers(r2), 1, 'document order does not split the line');
    assert.ok(
      !(await loadMyQueue(deputyActor)).items.some((i) => i.packageId === r1.id),
      'superseded return leaves the queue',
    );

    // Удаление комплекта каскадно убирает его замечания, ответы и назначения.
    await prisma.gostPackage.delete({ where: { id: v1.id } });
    assert.equal(await prisma.reviewComment.count({ where: { id: blocker.id } }), 0);
    assert.equal(await prisma.reviewCommentReply.count({ where: { commentId: blocker.id } }), 0);

    console.log(
      'Review workflow integration passed: carried-over blockers, approved-version barrier, legacy/archived/other-docs not carried, fixed-unverified blocks approval, status CHECKs, one active assignment per stage (P2002), deputy check, JSON fallback, cascades, idempotent overdue notifications, my-queue composition, mark-read scoping, document-order-insensitive lines.',
    );
  } finally {
    await prisma.gostPackage.deleteMany({ where: { calculation: { templateId: template.id } } });
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
    await prisma.notification.deleteMany({
      where: { userId: { in: [tw.id, gap.id, gapDeputy.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [tw.id, gap.id, gapDeputy.id] } } });
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
