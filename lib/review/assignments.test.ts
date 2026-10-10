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
    gostPackage: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    reviewComment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    reviewCommentReply: { create: vi.fn() },
    reviewAssignment: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { POST as decide } from '@/app/api/gost34/packages/[id]/review/route';
import { POST as assign } from '@/app/api/gost34/packages/[id]/assignments/route';
import { PATCH as changeComment } from '@/app/api/gost34/packages/[id]/comments/[commentId]/route';
import { POST as postComment } from '@/app/api/gost34/packages/[id]/comments/route';
import { countOpenBlockers } from './store';
import { openBlockerCount, type SectionComment } from '@/lib/gost34/review/types';
import {
  canResolveComment,
  carrySourceIds,
  checkCommentTransition,
  isSupersededPackage,
  validateAssignment,
  type CommentRuleSubject,
} from './workflow';

const db = vi.mocked(prisma, true);

const users: Record<string, { id: string; role: string }> = {
  tw1: { id: 'tw1', role: 'techwriter' },
  tw2: { id: 'tw2', role: 'techwriter' },
  gap1: { id: 'gap1', role: 'gap' },
  gap2: { id: 'gap2', role: 'gap' },
  arch: { id: 'arch', role: 'architect' },
};

function loginAs(id: string, role = users[id]?.role ?? id) {
  vi.mocked(getSession).mockResolvedValue({ userId: id, username: id, role, exp: 0 });
}

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
  package: {
    version: 1,
    calculationId: 'c1',
    documentTypes: '["tz"]',
    status: 'rejected',
    reviewStage: 'gap',
  },
  replies: [],
  ...over,
});

const linePkg = (id: string, version: number, status: string, over: object = {}) => ({
  id,
  calculationId: 'c1',
  documentTypes: '["tz"]',
  version,
  status,
  reviewStage: status === 'approved' ? 'done' : 'gap',
  ...over,
});
const line = [linePkg('p1', 1, 'rejected'), linePkg('p2', 2, 'under_review')];

/** Замечание существует и видно в комплекте из адреса. */
function stubComment(row: ReturnType<typeof commentRow>) {
  db.reviewComment.findUnique.mockResolvedValue(row as never);
  db.reviewComment.findMany.mockResolvedValue([row] as never);
}

const req = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const props = { params: Promise.resolve({ id: 'p2' }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SESSION_SECRET', 'review-assignment-tests-secret-32b');
  db.gostPackage.findUnique.mockResolvedValue(pkg() as never);
  db.reviewComment.findMany.mockResolvedValue([]);
  db.gostPackage.findMany.mockResolvedValue(line as never);
  db.reviewAssignment.findMany.mockResolvedValue([]);
  db.user.findMany.mockImplementation((async (args: { where: { id: { in: string[] } } }) =>
    args.where.id.in.map((id) => users[id]).filter(Boolean)) as never);
});

describe('Назначение не даёт права подписи', () => {
  it('назначенный тех.писатель получает 403 на решении этапа ГАП', async () => {
    // Даже если в базе оказалось активное назначение тех.писателя на этап ГАП
    // (например, роль пользователя сменили после назначения), гейт решения —
    // только роль этапа.
    db.reviewAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        packageId: 'p2',
        stage: 'gap',
        assigneeId: 'tw1',
        deputyId: null,
        dueAt: new Date('2026-10-20T00:00:00Z'),
        assignedBy: 'arch',
        assignedAt: new Date(),
        active: true,
      },
    ] as never);
    loginAs('tw1');

    const res = await decide(req({ decision: 'approve' }), props);

    expect(res.status).toBe(403);
    expect(db.gostPackage.update).not.toHaveBeenCalled();
  });

  it('тех.писателя нельзя назначить на этап ГАП', async () => {
    loginAs('arch');
    const res = await assign(
      req({ stage: 'gap', assigneeId: 'tw1', dueAt: '2026-10-20T00:00:00Z' }),
      props,
    );
    expect(res.status).toBe(400);
    expect(db.reviewAssignment.create).not.toHaveBeenCalled();
  });

  it('замещающий должен держать ту же роль', async () => {
    loginAs('arch');
    const res = await assign(
      req({ stage: 'gap', assigneeId: 'gap1', deputyId: 'tw1', dueAt: '2026-10-20T00:00:00Z' }),
      props,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('ту же роль') });
  });

  it('ГАП с замещающим-ГАПом назначается, прежнее назначение снимается', async () => {
    loginAs('arch');
    db.reviewAssignment.create.mockImplementation((async ({ data }: { data: object }) => ({
      id: 'a2',
      assignedAt: new Date(),
      ...data,
    })) as never);

    const res = await assign(
      req({ stage: 'gap', assigneeId: 'gap1', deputyId: 'gap2', dueAt: '2026-10-20T00:00:00Z' }),
      props,
    );

    expect(res.status).toBe(201);
    expect(db.reviewAssignment.updateMany).toHaveBeenCalledWith({
      where: { packageId: 'p2', stage: 'gap', active: true },
      data: { active: false },
    });
    expect((await res.json()).assignment).toMatchObject({ assigneeId: 'gap1', deputyId: 'gap2' });
  });

  it('рецензент не назначает ответственных', async () => {
    loginAs('rev', 'reviewer');
    const res = await assign(
      req({ stage: 'tw', assigneeId: 'tw1', dueAt: '2026-10-20T00:00:00Z' }),
      props,
    );
    expect(res.status).toBe(403);
  });
});

describe('Блокер закрывается только проверкой', () => {
  it('исправленный, но не проверенный блокер по-прежнему блокирует утверждение', async () => {
    db.reviewComment.findMany.mockResolvedValue([
      commentRow({
        status: 'fixed',
        fixedBy: 'arch',
        fixedAt: new Date(),
        fixedInPackageId: 'p2',
        fixedInVersion: 2,
      }),
    ] as never);
    loginAs('gap1');

    const res = await decide(req({ decision: 'approve' }), props);

    expect(res.status).toBe(409);
    expect(db.gostPackage.update).not.toHaveBeenCalled();
  });

  it('проверенный блокер утверждение не держит', async () => {
    db.reviewComment.findMany.mockResolvedValue([
      commentRow({
        status: 'verified',
        fixedInPackageId: 'p2',
        fixedInVersion: 2,
        fixedAt: new Date(),
        verifiedBy: 'gap1',
        verifiedAt: new Date(),
      }),
    ] as never);
    db.gostPackage.update.mockResolvedValue(
      pkg({ status: 'approved', reviewStage: 'done', approvedAt: new Date() }) as never,
    );
    loginAs('gap1');

    const res = await decide(req({ decision: 'approve' }), props);

    expect(res.status).toBe(200);
  });

  it('openBlockerCount не считает проверенные и отклонённые', () => {
    const c = (status: SectionComment['status']): SectionComment => ({
      id: String(status),
      sectionId: '1',
      severity: 'blocker',
      text: 't',
      author: 'a',
      createdAt: '2026-10-01',
      status,
    });
    expect(
      openBlockerCount([c('open'), c('fixed'), c('verified'), c('rejected'), c(undefined)], []),
    ).toBe(3);
  });
});

describe('Жизненный цикл замечания', () => {
  const subject = (over: Partial<CommentRuleSubject> = {}): CommentRuleSubject => ({
    status: 'open',
    stage: 'gap',
    author: 'gap1',
    authorId: 'gap1',
    packageLine: { calculationId: 'c1', documentTypes: '["tz"]' },
    packageVersion: 1,
    ...over,
  });
  const staff = (id: string, role: string) => ({
    kind: 'staff' as const,
    actorId: id,
    username: id,
    role,
  });

  it('«исправлено» требует более новой версии той же линии', () => {
    const actor = staff('arch', 'architect');
    expect(
      checkCommentTransition({
        subject: subject(),
        action: 'fix',
        actor,
        fixedIn: { calculationId: 'c1', documentTypes: '["tz"]', version: 1, status: 'rejected' },
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      checkCommentTransition({
        subject: subject(),
        action: 'fix',
        actor,
        fixedIn: { calculationId: 'c2', documentTypes: '["tz"]', version: 5, status: 'rejected' },
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      checkCommentTransition({
        subject: subject(),
        action: 'fix',
        actor,
        fixedIn: {
          calculationId: 'c1',
          documentTypes: '["tz"]',
          version: 2,
          status: 'under_review',
        },
      }),
    ).toEqual({ ok: true });
  });

  it('проверить может только автор или роль этапа', () => {
    const fixed = subject({ status: 'fixed', author: 'tw1', authorId: 'tw1' });
    expect(canResolveComment(fixed, staff('tw1', 'techwriter'))).toBe(true);
    expect(canResolveComment(fixed, staff('gap2', 'gap'))).toBe(true);
    expect(canResolveComment(fixed, staff('tw2', 'techwriter'))).toBe(false);
    expect(canResolveComment(fixed, staff('arch', 'architect'))).toBe(false);
    expect(
      checkCommentTransition({
        subject: fixed,
        action: 'verify',
        actor: staff('arch', 'architect'),
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('перенесённое из JSON замечание опознаёт автора по логину', () => {
    const legacy = subject({ status: 'fixed', stage: 'tw', author: 'tw2', authorId: null });
    expect(canResolveComment(legacy, staff('tw2', 'reviewer'))).toBe(true);
    expect(canResolveComment(legacy, { kind: 'share', actorId: 'share:c1' })).toBe(false);
  });

  it('проверить можно только исправленное', () => {
    expect(
      checkCommentTransition({ subject: subject(), action: 'verify', actor: staff('gap1', 'gap') }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it('маршрут: отметка «исправлено» в той же версии отклоняется', async () => {
    db.gostPackage.findUnique.mockResolvedValue(pkg({ id: 'p1', version: 1 }) as never);
    stubComment(commentRow());
    loginAs('arch');

    const res = await changeComment(req({ action: 'fix' }), {
      params: Promise.resolve({ id: 'p1', commentId: 'rc1' }),
    });

    expect(res.status).toBe(400);
    expect(db.reviewComment.updateMany).not.toHaveBeenCalled();
  });

  it('маршрут: архитектор отмечает исправление в новой версии со ссылкой на неё', async () => {
    stubComment(commentRow());
    db.reviewComment.updateMany.mockResolvedValue({ count: 1 } as never);
    loginAs('arch');

    const res = await changeComment(req({ action: 'fix' }), {
      params: Promise.resolve({ id: 'p2', commentId: 'rc1' }),
    });

    expect(res.status).toBe(200);
    expect(db.reviewComment.updateMany).toHaveBeenCalledWith({
      where: { id: 'rc1', status: 'open' },
      data: expect.objectContaining({
        status: 'fixed',
        fixedInPackageId: 'p2',
        fixedInVersion: 2,
      }),
    });
  });

  it('маршрут: тех.писатель не проверяет чужое замечание этапа ГАП', async () => {
    stubComment(commentRow({ status: 'fixed', fixedInPackageId: 'p2', fixedInVersion: 2 }));
    loginAs('tw1');

    const res = await changeComment(req({ action: 'verify' }), {
      params: Promise.resolve({ id: 'p2', commentId: 'rc1' }),
    });

    expect(res.status).toBe(403);
    expect(db.reviewComment.updateMany).not.toHaveBeenCalled();
  });
});

describe('Перенос замечаний по линии комплекта', () => {
  it('утверждённая версия — барьер: блокер v1 не доходит до v3 после утверждённой v2', () => {
    const v3 = linePkg('p3', 3, 'under_review');
    const lineV = [linePkg('p1', 1, 'rejected'), linePkg('p2', 2, 'approved'), v3];
    expect(carrySourceIds(v3, lineV)).toEqual([]);
  });

  it('переносятся только выпущенные версии той же линии после барьера', () => {
    const v5 = linePkg('p5', 5, 'under_review');
    const lineV = [
      linePkg('p1', 1, 'approved'),
      linePkg('p2', 2, 'rejected'),
      linePkg('p3', 3, 'archived'),
      linePkg('p4', 4, 'rejected', { documentTypes: '["pmi"]' }),
      linePkg('px', 2, 'rejected', { calculationId: 'c2' }),
      v5,
    ];
    expect(carrySourceIds(v5, lineV)).toEqual(['p2']);
  });

  it('запрос не берёт перенос из-за барьера и никогда не переносит legacy', async () => {
    db.gostPackage.findMany.mockResolvedValue([
      linePkg('p1', 1, 'rejected'),
      linePkg('p2', 2, 'approved'),
      linePkg('p3', 3, 'under_review'),
      linePkg('p4', 4, 'under_review'),
    ] as never);
    await countOpenBlockers(pkg({ id: 'p3', version: 3 }) as never);
    expect(db.reviewComment.findMany.mock.calls[0][0]?.where?.OR).toHaveLength(2);

    await countOpenBlockers(pkg({ id: 'p4', version: 4 }) as never);
    expect(db.reviewComment.findMany.mock.calls[1][0]?.where?.OR?.[2]).toEqual({
      packageId: { in: ['p3'] },
      status: { in: ['open', 'fixed'] },
      legacy: false,
    });
  });

  it('черновик не заменяет комплект, выпущенная новая версия — заменяет', () => {
    const v1 = linePkg('p1', 1, 'under_review');
    expect(isSupersededPackage(v1, [v1, linePkg('d', 2, 'draft')])).toBe(false);
    expect(isSupersededPackage(v1, [v1, linePkg('p2', 2, 'under_review')])).toBe(true);
  });

  it('маршрут: замечание к заменённой версии — 409', async () => {
    db.gostPackage.findUnique.mockResolvedValue(
      pkg({ id: 'p1', version: 1, status: 'rejected' }) as never,
    );
    loginAs('gap1');
    const res = await postComment(req({ sectionId: '1', text: 'x', severity: 'blocker' }), {
      params: Promise.resolve({ id: 'p1' }),
    });
    expect(res.status).toBe(409);
    expect(db.reviewComment.create).not.toHaveBeenCalled();
  });

  it('маршрут: замечание вне видимой линии — 404', async () => {
    db.reviewComment.findUnique.mockResolvedValue(commentRow() as never);
    db.reviewComment.findMany.mockResolvedValue([]);
    loginAs('gap1');
    const res = await changeComment(req({ action: 'reject' }), {
      params: Promise.resolve({ id: 'p2', commentId: 'rc1' }),
    });
    expect(res.status).toBe(404);
  });

  it('маршрут: замечание утверждённого комплекта неизменяемо', async () => {
    stubComment(
      commentRow({
        package: { ...commentRow().package, status: 'approved', reviewStage: 'done' },
      }),
    );
    loginAs('gap1');
    const res = await changeComment(req({ action: 'reject' }), {
      params: Promise.resolve({ id: 'p2', commentId: 'rc1' }),
    });
    expect(res.status).toBe(409);
    expect(db.reviewComment.updateMany).not.toHaveBeenCalled();
  });

  it('маршрут: гонка назначений (P2002) — 409', async () => {
    loginAs('arch');
    db.reviewAssignment.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    const res = await assign(
      req({ stage: 'gap', assigneeId: 'gap1', dueAt: '2026-10-20T00:00:00Z' }),
      props,
    );
    expect(res.status).toBe(409);
  });
});

describe('Права на переходы', () => {
  const staff = (id: string, role: string) => ({
    kind: 'staff' as const,
    actorId: id,
    username: id,
    role,
  });
  const base: CommentRuleSubject = {
    status: 'open',
    stage: 'gap',
    author: 'gap1',
    authorId: 'gap1',
    packageVersion: 1,
    packageLine: { calculationId: 'c1', documentTypes: '["tz"]' },
  };
  const target = {
    calculationId: 'c1',
    documentTypes: '["tz"]',
    version: 2,
    status: 'under_review',
  };

  it('перенесённое из JSON замечание закрывает роль любого этапа', () => {
    const migrated = { ...base, status: 'fixed' as const, authorId: 'x', legacy: true };
    expect(canResolveComment(migrated, staff('tw1', 'techwriter'))).toBe(true);
    expect(canResolveComment({ ...migrated, legacy: false }, staff('tw1', 'techwriter'))).toBe(
      false,
    );
    expect(canResolveComment(migrated, staff('rev', 'reviewer'))).toBe(false);
  });

  it('«исправлено» не ставят рецензент и гость по ссылке', () => {
    for (const actor of [
      staff('rev', 'reviewer'),
      { kind: 'share' as const, actorId: 'share:c1' },
    ]) {
      expect(
        checkCommentTransition({ subject: base, action: 'fix', actor, fixedIn: target }),
      ).toMatchObject({ ok: false, status: 403 });
    }
    expect(
      checkCommentTransition({
        subject: base,
        action: 'fix',
        actor: staff('tw1', 'techwriter'),
        fixedIn: target,
      }),
    ).toEqual({ ok: true });
  });

  it('исправление не фиксируется в черновике', () => {
    expect(
      checkCommentTransition({
        subject: base,
        action: 'fix',
        actor: staff('arch', 'architect'),
        fixedIn: { ...target, status: 'draft' },
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});

describe('validateAssignment', () => {
  it('требует срок', () => {
    expect(validateAssignment({ stage: 'tw', assignee: users.tw1, dueAt: null })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
  it('замещающий не совпадает с исполнителем', () => {
    expect(
      validateAssignment({
        stage: 'tw',
        assignee: users.tw1,
        deputy: users.tw1,
        dueAt: new Date(),
      }),
    ).toMatchObject({ ok: false });
  });
});
