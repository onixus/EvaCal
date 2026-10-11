import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')),
  getSession: vi.fn(async () => null),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(() => 'user'),
}));
vi.mock('@/lib/changelog', () => ({ recordInternalChangeSafe: vi.fn() }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    gostPackage: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    reviewComment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    reviewCommentReply: { create: vi.fn() },
    reviewAssignment: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    notification: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { POST as decide } from '@/app/api/gost34/packages/[id]/review/route';
import { POST as assign } from '@/app/api/gost34/packages/[id]/assignments/route';
import {
  PATCH as changeComment,
  POST as replyToComment,
} from '@/app/api/gost34/packages/[id]/comments/[commentId]/route';
import { GET as getQueue } from '@/app/api/me/queue/route';
import { POST as markRead } from '@/app/api/me/notifications/route';
import { GET as getBadges } from '@/app/api/nav/badges/route';
import {
  assignmentDrafts,
  notificationActorName,
  overdueDrafts,
  resetOverdueSyncCache,
  returnedDrafts,
  saveNotifications,
  syncOverdueNotifications,
  type OverdueSource,
} from './notifications';
import {
  composeQueue,
  distinctBadgeCount,
  type QueueAssignmentSource,
  type QueueCommentSource,
  type QueueReturnedSource,
} from './queue';
import { carrySourceIds, normalizeDocumentTypes, sameLine, type ReviewActor } from './workflow';

const db = vi.mocked(prisma, true);

const users: Record<string, { id: string; role: string }> = {
  tw1: { id: 'tw1', role: 'techwriter' },
  gap1: { id: 'gap1', role: 'gap' },
  gap2: { id: 'gap2', role: 'gap' },
  arch: { id: 'arch', role: 'architect' },
};

function loginAs(id: string, role = users[id]?.role ?? id) {
  vi.mocked(getSession).mockResolvedValue({ userId: id, username: id, role, exp: 0 });
}

const NOW = new Date('2026-10-20T12:00:00Z');

const pkg = (over: Record<string, unknown> = {}) => ({
  id: 'p2',
  calculationId: 'c1',
  projectId: 'prj1',
  documentTypes: '["tz"]',
  name: 'Комплект',
  version: 2,
  status: 'under_review',
  reviewStage: 'gap',
  reviewChecklist: null,
  reviewComments: null,
  checksum: 'abc',
  approvedAt: null,
  approvedBy: null,
  reviewComment: null,
  releasedBy: 'arch',
  createdBy: 'arch',
  snapshot: null,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

const commentRow = (over: Record<string, unknown> = {}) => ({
  id: 'rc1',
  packageId: 'p1',
  stage: 'gap',
  sectionId: '4.1',
  severity: 'blocker',
  text: 'Противоречие таблице требований',
  author: 'gap1',
  authorId: 'gap1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  status: 'open',
  fixedBy: null,
  fixedAt: null,
  fixedInPackageId: null,
  fixedInVersion: null,
  verifiedBy: null,
  verifiedAt: null,
  legacy: false,
  package: {
    version: 1,
    calculationId: 'c1',
    documentTypes: '["tz"]',
    status: 'rejected',
    reviewStage: 'gap',
  },
  replies: [] as {
    id: string;
    text: string;
    author: string;
    authorId: string | null;
    createdAt: Date;
  }[],
  ...over,
});

const line = [
  { id: 'p1', calculationId: 'c1', documentTypes: '["tz"]', version: 1, status: 'rejected' },
  { id: 'p2', calculationId: 'c1', documentTypes: '["tz"]', version: 2, status: 'under_review' },
];

const req = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const props = { params: Promise.resolve({ id: 'p2' }) };
const commentProps = { params: Promise.resolve({ id: 'p2', commentId: 'rc1' }) };

/** Записанные уведомления: [userId, kind] для компактных проверок. */
function created(): [string, string][] {
  return db.notification.createMany.mock.calls.flatMap(([args]) =>
    (args as { data: { userId: string; kind: string }[] }).data.map(
      (d) => [d.userId, d.kind] as [string, string],
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOverdueSyncCache();
  vi.mocked(getSession).mockResolvedValue(null);
  vi.stubEnv('SESSION_SECRET', 'review-notification-tests-secret-32');
  db.gostPackage.findUnique.mockResolvedValue(pkg() as never);
  db.gostPackage.findMany.mockResolvedValue(line as never);
  db.reviewComment.findMany.mockResolvedValue([]);
  db.reviewAssignment.findMany.mockResolvedValue([]);
  db.user.findMany.mockImplementation((async (args: { where: { id: { in: string[] } } }) =>
    args.where.id.in.map((id) => users[id]).filter(Boolean)) as never);
  db.notification.createMany.mockImplementation((async (args: { data: unknown[] }) => ({
    count: args.data.length,
  })) as never);
  db.notification.findMany.mockResolvedValue([]);
  db.notification.count.mockResolvedValue(0);
});

describe('Триггеры уведомлений', () => {
  it('назначение: исполнителю и замещающему, но не назначившему', async () => {
    loginAs('gap1');
    db.reviewAssignment.create.mockImplementation((async ({ data }: { data: object }) => ({
      id: 'a1',
      assignedAt: new Date(),
      ...data,
    })) as never);

    const res = await assign(
      req({ stage: 'gap', assigneeId: 'gap1', deputyId: 'gap2', dueAt: '2026-10-25T00:00:00Z' }),
      props,
    );

    expect(res.status).toBe(201);
    // gap1 назначил сам себя — о своём действии не уведомляем.
    expect(created()).toEqual([['gap2', 'deputy_assigned']]);
    const [{ data }] = db.notification.createMany.mock.calls[0] as unknown as [
      { data: { entityType: string; entityId: string; payload: { packageId: string } }[] },
    ];
    expect(data[0]).toMatchObject({
      entityType: 'review_assignment',
      entityId: 'a1',
      payload: { packageId: 'p2', stage: 'gap' },
    });
  });

  it('возврат: автору выпуска и ответственным этапов комплекта', async () => {
    loginAs('gap1');
    db.reviewAssignment.findMany.mockResolvedValue([
      { assigneeId: 'gap1', deputyId: 'gap2' },
      { assigneeId: 'tw1', deputyId: null },
    ] as never);
    db.gostPackage.update.mockResolvedValue(pkg({ status: 'rejected' }) as never);

    const res = await decide(
      req({ decision: 'reject', comment: 'Нет трассировки', reviewerName: 'Чужое Имя' }),
      props,
    );

    expect(res.status).toBe(200);
    // Имя в уведомлении — из сессии, а не из тела запроса.
    const [{ data: sent }] = db.notification.createMany.mock.calls[0] as unknown as [
      { data: { payload: { actor: string } }[] },
    ];
    expect(sent.every((d) => d.payload.actor === 'gap1')).toBe(true);
    expect(created().sort()).toEqual([
      ['arch', 'returned'],
      ['gap2', 'returned'],
      ['tw1', 'returned'],
    ]);
  });

  it('повторный возврат уже возвращённого комплекта — 409 без уведомлений', async () => {
    loginAs('gap1');
    db.gostPackage.findUnique.mockResolvedValue(pkg({ status: 'rejected' }) as never);

    const res = await decide(req({ decision: 'reject' }), props);

    expect(res.status).toBe(409);
    expect(db.gostPackage.update).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('проверка, отклонение и возврат исправления — тому, кто его отметил', async () => {
    loginAs('gap1');
    const row = commentRow({
      status: 'fixed',
      fixedBy: 'arch',
      fixedAt: new Date(),
      fixedInPackageId: 'p2',
      fixedInVersion: 2,
    });
    db.reviewComment.findUnique.mockResolvedValue(row as never);
    db.reviewComment.findMany.mockResolvedValue([row] as never);
    db.reviewComment.updateMany.mockResolvedValue({ count: 1 });
    db.user.findUnique.mockResolvedValue({ id: 'arch' } as never);

    for (const [action, kind] of [
      ['verify', 'comment_verified'],
      ['reopen', 'comment_reopened'],
      ['reject', 'comment_rejected'],
    ] as const) {
      db.notification.createMany.mockClear();
      const res = await changeComment(req({ action }), commentProps);
      expect(res.status).toBe(200);
      expect(created()).toEqual([['arch', kind]]);
    }
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'arch' },
      select: { id: true },
    });
  });

  it('имя действующего лица — из сессии, гость — «гость (ссылка)»', () => {
    expect(notificationActorName({ kind: 'staff', session: { username: 'gap1' } })).toBe('gap1');
    expect(notificationActorName({ kind: 'share' })).toBe('гость (ссылка)');
  });

  it('утверждение никого не уведомляет о возврате', async () => {
    loginAs('gap1');
    db.gostPackage.update.mockResolvedValue(
      pkg({ status: 'approved', reviewStage: 'done', approvedAt: new Date() }) as never,
    );
    const res = await decide(req({ decision: 'approve' }), props);
    expect(res.status).toBe(200);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('ответ в ветке: автору замечания и прежним участникам', async () => {
    loginAs('arch');
    const row = commentRow({
      replies: [{ id: 'r1', text: 'Уточните', author: 'tw1', authorId: 'tw1', createdAt: NOW }],
    });
    db.reviewComment.findUnique.mockResolvedValue(row as never);
    db.reviewComment.findMany.mockResolvedValue([row] as never);

    const res = await replyToComment(req({ text: 'Исправлено в v2' }), commentProps);

    expect(res.status).toBe(201);
    expect(created().sort()).toEqual([
      ['gap1', 'comment_reply'],
      ['tw1', 'comment_reply'],
    ]);
  });

  it('«исправлено»: автору замечания и ответственному за этап', async () => {
    loginAs('arch');
    const row = commentRow({ author: 'gap2', authorId: 'gap2' });
    db.reviewComment.findUnique.mockResolvedValue(row as never);
    db.reviewComment.findMany.mockResolvedValue([row] as never);
    db.reviewComment.updateMany.mockResolvedValue({ count: 1 });
    db.reviewAssignment.findMany.mockResolvedValue([
      { assigneeId: 'gap1', deputyId: null },
    ] as never);

    const res = await changeComment(req({ action: 'fix' }), commentProps);

    expect(res.status).toBe(200);
    expect(db.reviewAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { packageId: 'p2', stage: 'gap', active: true } }),
    );
    expect(created().sort()).toEqual([
      ['gap1', 'comment_fixed'],
      ['gap2', 'comment_fixed'],
    ]);
  });

  it('сбой записи уведомления не роняет основное действие', async () => {
    loginAs('gap1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.notification.createMany.mockRejectedValue(new Error('db down'));
    db.gostPackage.update.mockResolvedValue(pkg({ status: 'rejected' }) as never);

    const res = await decide(req({ decision: 'reject' }), props);

    expect(res.status).toBe(200);
  });

  it('уведомления получают только существующие пользователи', async () => {
    const count = await saveNotifications([
      ...assignmentDrafts({
        pkg: { id: 'p2', name: 'К', version: 2 },
        assignment: {
          id: 'a1',
          stage: 'tw',
          assigneeId: 'tw1',
          deputyId: null,
          dueAt: NOW,
        },
        actorId: 'arch',
      }),
      ...returnedDrafts({
        pkg: { id: 'p2', name: 'К', version: 2 },
        stage: 'tw',
        // releasedBy старых строк — «architect», это не User.id
        authorIds: ['architect', 'share:c1'],
        assignments: [],
        actorId: 'tw1',
      }),
    ]);
    expect(count).toBe(1);
    expect(created()).toEqual([['tw1', 'assigned']]);
  });
});

describe('Просрочка: ленивая и идемпотентная', () => {
  const source = (over: Partial<OverdueSource> = {}): OverdueSource => ({
    id: 'a1',
    packageId: 'p2',
    stage: 'gap',
    assigneeId: 'gap1',
    deputyId: 'gap2',
    dueAt: new Date('2026-10-19T00:00:00Z'),
    package: { name: 'К', version: 2, status: 'under_review', reviewStage: 'gap' },
    ...over,
  });

  it('просрочено только назначение на текущем этапе после срока', () => {
    expect(overdueDrafts('gap1', [source()], NOW)).toHaveLength(1);
    expect(overdueDrafts('gap2', [source()], NOW)[0]).toMatchObject({
      kind: 'overdue',
      entityId: 'a1',
      dueAt: new Date('2026-10-19T00:00:00Z'),
    });
    // срок не наступил
    expect(overdueDrafts('gap1', [source({ dueAt: new Date('2026-10-21') })], NOW)).toEqual([]);
    // комплект ещё на нормоконтроле — этап ГАП не начался
    expect(
      overdueDrafts(
        'gap1',
        [source({ package: { name: 'К', version: 2, status: 'under_review', reviewStage: 'tw' } })],
        NOW,
      ),
    ).toEqual([]);
    // возвращён — ждёт автора, а не ответственного
    expect(
      overdueDrafts(
        'gap1',
        [source({ package: { name: 'К', version: 2, status: 'rejected', reviewStage: 'gap' } })],
        NOW,
      ),
    ).toEqual([]);
    // чужое назначение
    expect(overdueDrafts('tw1', [source()], NOW)).toEqual([]);
  });

  it('повторное чтение очереди не плодит дублей', async () => {
    // Хранилище с тем же ключом уникальности, что и в миграции.
    const store = new Map<string, unknown>();
    db.notification.createMany.mockImplementation((async (args: {
      data: { userId: string; kind: string; entityId: string; dueAt: Date | null }[];
      skipDuplicates?: boolean;
    }) => {
      expect(args.skipDuplicates).toBe(true);
      let count = 0;
      for (const d of args.data) {
        const key = `${d.userId}|${d.kind}|${d.entityId}|${d.dueAt?.toISOString() ?? Math.random()}`;
        if (!store.has(key)) {
          store.set(key, d);
          count += 1;
        }
      }
      return { count };
    }) as never);
    db.reviewAssignment.findMany.mockResolvedValue([source()] as never);

    expect(await syncOverdueNotifications('gap1', NOW)).toBe(1);
    expect(await syncOverdueNotifications('gap1', NOW)).toBe(0);
    expect(store.size).toBe(1);

    // Перенос срока — новое назначение и новая просрочка.
    db.reviewAssignment.findMany.mockResolvedValue([
      source({ id: 'a2', dueAt: new Date('2026-10-20T06:00:00Z') }),
    ] as never);
    expect(await syncOverdueNotifications('gap1', NOW)).toBe(1);
    expect(store.size).toBe(2);
  });
});

describe('Очередь «Требует моего действия»', () => {
  const me: ReviewActor = { kind: 'staff', actorId: 'gap1', username: 'gap1', role: 'gap' };
  const pkgInfo = (over: Record<string, unknown> = {}) => ({
    id: 'p2',
    name: 'Комплект',
    version: 2,
    status: 'under_review',
    reviewStage: 'gap',
    calculationId: 'c1',
    documentTypes: '["tz"]',
    ...over,
  });
  const assignment = (over: Partial<QueueAssignmentSource> = {}): QueueAssignmentSource => ({
    id: 'a1',
    packageId: 'p2',
    stage: 'gap',
    assigneeId: 'gap1',
    deputyId: null,
    dueAt: new Date('2026-10-25T00:00:00Z'),
    assignedAt: new Date('2026-10-18T00:00:00Z'),
    package: pkgInfo(),
    ...over,
  });
  const fixed = (over: Partial<QueueCommentSource> = {}): QueueCommentSource => ({
    id: 'rc1',
    packageId: 'p1',
    stage: 'gap',
    sectionId: '4.1',
    severity: 'blocker',
    text: 'Противоречие',
    author: 'gap2',
    authorId: 'gap2',
    legacy: false,
    fixedAt: new Date('2026-10-19T00:00:00Z'),
    fixedInPackageId: 'p2',
    fixedInVersion: 2,
    package: pkgInfo({ id: 'p1', version: 1, status: 'rejected' }),
    ...over,
  });
  const returned = (over: Partial<QueueReturnedSource> = {}): QueueReturnedSource => ({
    ...pkgInfo({ id: 'p9', calculationId: 'c9', status: 'rejected', reviewStage: 'tw' }),
    reviewComment: 'Нет ПМИ',
    stageEnteredAt: new Date('2026-10-10T00:00:00Z'),
    updatedAt: new Date('2026-10-10T00:00:00Z'),
    ...over,
  });

  it('собирает назначения, проверки и возвраты; просроченное сверху', () => {
    const items = composeQueue({
      actor: me,
      assignments: [
        assignment(),
        assignment({
          id: 'a2',
          packageId: 'p3',
          deputyId: 'gap1',
          assigneeId: 'gap2',
          dueAt: new Date('2026-10-19T00:00:00Z'),
          package: pkgInfo({ id: 'p3' }),
        }),
      ],
      fixedComments: [fixed()],
      returned: [{ ...returned(), releasedBy: 'gap1' } as QueueReturnedSource],
      lines: [{ ...returned(), version: 2 }],
      now: NOW,
    });
    expect(items.map((i) => i.key)).toEqual([
      'assignment:a2',
      'assignment:a1',
      'returned:p9',
      'verify:rc1',
    ]);
    expect(items[0]).toMatchObject({ overdue: true, as: 'deputy', href: '/review/p3' });
    expect(items.find((i) => i.kind === 'verify')).toMatchObject({ href: '/review/p2' });
    expect(items.find((i) => i.kind === 'returned')).toMatchObject({
      href: '/calculations/c9/studio',
      detail: 'Возвращён на этапе «нормоконтроль»: Нет ПМИ',
    });
  });

  it('назначение на этап, до которого комплект не дошёл, — не задача', () => {
    const items = composeQueue({
      actor: me,
      assignments: [assignment({ package: pkgInfo({ reviewStage: 'tw' }) })],
      fixedComments: [],
      returned: [],
      lines: [],
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it('проверку получает только тот, кто вправе закрыть замечание', () => {
    // Назначенный на этап, но с чужой ролью (роль сменили) — права нет.
    const items = composeQueue({
      actor: { ...me, role: 'techwriter' },
      assignments: [assignment()],
      fixedComments: [fixed()],
      returned: [],
      lines: [],
      now: NOW,
    });
    expect(items.map((i) => i.kind)).toEqual(['assignment']);
  });

  it('проверку получает автор, даже без назначения', () => {
    const items = composeQueue({
      actor: { kind: 'staff', actorId: 'gap2', username: 'gap2', role: 'reviewer' },
      assignments: [],
      fixedComments: [fixed()],
      returned: [],
      lines: [],
      now: NOW,
    });
    expect(items.map((i) => i.key)).toEqual(['verify:rc1']);
  });

  it('замечание, после которого линия уже утверждена, — не задача', () => {
    const items = composeQueue({
      actor: me,
      assignments: [],
      fixedComments: [fixed({ author: 'gap1', authorId: 'gap1' })],
      returned: [],
      lines: [
        { id: 'p1', calculationId: 'c1', documentTypes: '["tz"]', version: 1, status: 'rejected' },
        {
          id: 'p5',
          calculationId: 'c1',
          documentTypes: '["tz"]',
          version: 5,
          status: 'approved',
          reviewStage: 'done',
        },
      ],
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it('бейдж не считает дважды задачу и уведомление о ней', () => {
    const items = [{ entityId: 'a1' }, { entityId: 'rc1' }];
    expect(distinctBadgeCount(items, ['a1', 'a1', 'rc1', 'x', 'x', 'y'])).toBe(4);
    expect(distinctBadgeCount([], [])).toBe(0);
  });

  it('замечание к утверждённому комплекту в очередь не идёт', () => {
    const items = composeQueue({
      actor: me,
      assignments: [assignment()],
      fixedComments: [fixed()],
      fixedInPackages: [{ id: 'p2', status: 'approved', reviewStage: 'done' }],
      returned: [],
      lines: [],
      now: NOW,
    });
    expect(items.map((i) => i.kind)).toEqual(['assignment']);
  });

  it('возврат, заменённый новой выпущенной версией, — уже не задача', () => {
    const r = returned();
    const items = composeQueue({
      actor: me,
      assignments: [],
      fixedComments: [],
      returned: [r],
      lines: [
        { ...r, version: 2 },
        { ...r, id: 'p10', version: 3, status: 'under_review' },
      ],
      now: NOW,
    });
    expect(items).toEqual([]);
  });
});

describe('Маршруты очереди и уведомлений', () => {
  it('гость без сессии очередь не получает', async () => {
    const res = await getQueue();
    expect(res.status).toBe(401);
  });

  it('очередь дописывает просрочку и возвращает задачи', async () => {
    loginAs('gap1');
    db.reviewAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        packageId: 'p2',
        stage: 'gap',
        assigneeId: 'gap1',
        deputyId: null,
        dueAt: new Date('2020-01-01T00:00:00Z'),
        assignedAt: new Date('2019-12-25T00:00:00Z'),
        package: {
          id: 'p2',
          name: 'К',
          version: 2,
          status: 'under_review',
          reviewStage: 'gap',
          calculationId: 'c1',
          documentTypes: '["tz"]',
        },
      },
    ] as never);
    db.gostPackage.findMany.mockResolvedValue([]);
    db.notification.count.mockResolvedValue(1);

    const res = await getQueue();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(created()).toEqual([['gap1', 'overdue']]);
    // Задача и уведомление о её просрочке — одно дело в счётчике.
    expect(body).toMatchObject({ overdue: 1, unread: 1 });
    expect(body.items[0]).toMatchObject({ kind: 'assignment', overdue: true });
  });

  it('бейдж myQueue — различимые непрочитанные дела', async () => {
    loginAs('tw1');
    db.gostPackage.count.mockResolvedValue(0);
    db.notification.findMany.mockResolvedValue([
      { entityId: 'rc1' },
      { entityId: 'rc1' },
      { entityId: 'p2' },
    ] as never);
    const res = await getBadges();
    expect((await res.json()).badges).toMatchObject({ myQueue: 2, myQueueOverdue: 0 });
  });

  it('пресейлу очередь считается: уведомления о его запросах на изменение (#103 §1)', async () => {
    loginAs('pre', 'presale');
    const res = await getBadges();
    expect((await res.json()).badges).toHaveProperty('myQueue');
  });

  it('отметить прочитанными можно только свои уведомления', async () => {
    loginAs('tw1');
    db.notification.updateMany.mockResolvedValue({ count: 1 });

    const res = await markRead(req({ ids: ['n1', 'n2'] }));

    expect(res.status).toBe(200);
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'tw1', readAt: null, id: { in: ['n1', 'n2'] } },
      data: { readAt: expect.any(Date) },
    });
  });

  it('«прочитать все» и проверка тела запроса', async () => {
    loginAs('tw1');
    db.notification.updateMany.mockResolvedValue({ count: 4 });
    const all = await markRead(req({ all: true }));
    expect(await all.json()).toEqual({ marked: 4 });
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'tw1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect((await markRead(req({ ids: [1] }))).status).toBe(400);
  });
});

describe('Состав документов линии не зависит от порядка', () => {
  it('normalizeDocumentTypes сортирует и убирает повторы', () => {
    expect(normalizeDocumentTypes(['tz', 'pmi'])).toBe('["pmi","tz"]');
    expect(normalizeDocumentTypes('["TZ","pmi","tz"]')).toBe('["pmi","tz"]');
    expect(normalizeDocumentTypes('not json')).toBe('not json');
  });

  it('["pmi","tz"] и ["tz","pmi"] — одна линия ревью', () => {
    expect(
      sameLine(
        { calculationId: 'c1', documentTypes: '["pmi","tz"]' },
        { calculationId: 'c1', documentTypes: '["tz","pmi"]' },
      ),
    ).toBe(true);
    expect(
      sameLine(
        { calculationId: 'c1', documentTypes: '["tz"]' },
        { calculationId: 'c1', documentTypes: '["tz","pmi"]' },
      ),
    ).toBe(false);
    // Старые строки с другим порядком переносят замечания без миграции данных.
    const v1 = {
      id: 'p1',
      calculationId: 'c1',
      documentTypes: '["tz","pmi"]',
      version: 1,
      status: 'rejected',
    };
    const v2 = {
      ...v1,
      id: 'p2',
      documentTypes: '["pmi","tz"]',
      version: 2,
      status: 'under_review',
    };
    expect(carrySourceIds(v2, [v1, v2])).toEqual(['p1']);
  });
});
