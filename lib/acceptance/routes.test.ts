import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')),
  getSession: vi.fn(async () => null),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    gostPackage: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    acceptanceResult: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/acceptance/store', () => ({
  listChecks: vi.fn(async () => []),
  countPendingSeeds: vi.fn(async () => 2),
  summarize: vi.fn(() => ({ total: 0, byStatus: {}, openRemarks: 0 })),
  seedChecks: vi.fn(async () => ({ created: 2, total: 2 })),
  loadCheck: vi.fn(),
  recordResult: vi.fn(async () => ({
    ok: true,
    value: { result: { id: 'r1', status: 'passed' }, remark: null },
  })),
  uploadEvidence: vi.fn(),
  deleteEvidence: vi.fn(),
  findEvidence: vi.fn(),
  createRemark: vi.fn(async () => ({ id: 'm1' })),
  transitionRemark: vi.fn(),
  editRemarkText: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createShareToken, type ShareScope } from '@/lib/access';
import { GET as listRoute, POST as seedRoute } from '@/app/api/gost34/packages/[id]/checks/route';
import { POST as recordRoute } from '@/app/api/gost34/packages/[id]/checks/[checkId]/results/route';
import { POST as remarkRoute } from '@/app/api/gost34/packages/[id]/checks/[checkId]/remarks/route';
import { PATCH as remarkPatch } from '@/app/api/gost34/packages/[id]/checks/[checkId]/remarks/[remarkId]/route';
import {
  GET as evidenceGet,
  POST as evidencePost,
} from '@/app/api/gost34/packages/[id]/checks/[checkId]/evidence/route';
import {
  editRemarkText,
  findEvidence,
  loadCheck,
  recordResult,
  seedChecks,
  transitionRemark,
  uploadEvidence,
} from '@/lib/acceptance/store';

const pkgProps = { params: Promise.resolve({ id: 'p1' }) };
const checkProps = { params: Promise.resolve({ id: 'p1', checkId: 'c1' }) };
const remarkProps = { params: Promise.resolve({ id: 'p1', checkId: 'c1', remarkId: 'm1' }) };

const token = (scopes: ShareScope[]) => createShareToken({ calculationId: 'calc1', scopes });
const request = (body?: unknown, share?: string, method = body ? 'POST' : 'GET') =>
  new NextRequest('http://localhost/x', {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json', ...(share ? { 'X-Share-Token': share } : {}) },
  });
const asRole = (role: string) =>
  vi.mocked(getSession).mockResolvedValue({
    userId: `u-${role}`,
    username: `${role}-login`,
    role,
    exp: Date.now() + 60_000,
  });

const approved = {
  id: 'p1',
  calculationId: 'calc1',
  version: 3,
  status: 'approved',
  reviewStage: 'done',
  snapshot: null,
};
const passed = {
  status: 'passed',
  executorName: 'Иванов',
  executedAt: '2026-10-01T10:00:00Z',
  actualResult: 'Работает',
};

describe('Маршруты проверок приёмки', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'acceptance-tests-secret-32-bytes!');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(approved as never);
    vi.mocked(loadCheck).mockResolvedValue({
      id: 'c1',
      requirementCode: 'ТР-01',
      status: 'not_run',
      remarks: [],
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('без входа и токена — ни чтения, ни записи', async () => {
    expect((await listRoute(request(), pkgProps)).status).toBe(401);
    expect((await recordRoute(request(passed), checkProps)).status).toBe(401);
    expect(recordResult).not.toHaveBeenCalled();
  });

  it('share-ссылка только читает: даже write/review/export не дают записи', async () => {
    const read = await listRoute(request(undefined, token(['read'])), pkgProps);
    expect(read.status).toBe(200);
    expect((await read.json()).canRecord).toBe(false);
    const strong = token(['read', 'write', 'review', 'export']);
    expect((await recordRoute(request(passed, strong), checkProps)).status).toBe(403);
    expect((await seedRoute(request({}, strong), pkgProps)).status).toBe(403);
    expect((await remarkRoute(request({ text: 'x' }, strong), checkProps)).status).toBe(403);
    expect(recordResult).not.toHaveBeenCalled();
  });

  it('токен другого расчёта не читает проверки', async () => {
    const other = createShareToken({ calculationId: 'other', scopes: ['read'] });
    expect((await listRoute(request(undefined, other), pkgProps)).status).toBe(403);
  });

  it.each(['presale', 'techwriter', 'reviewer'])('роль %s читает, но не записывает', async (r) => {
    asRole(r);
    const list = await listRoute(request(), pkgProps);
    expect(list.status).toBe(200);
    expect((await list.json()).canRecord).toBe(false);
    expect((await recordRoute(request(passed), checkProps)).status).toBe(403);
  });

  it.each(['architect', 'gap', 'admin'])('роль %s записывает результат', async (r) => {
    asRole(r);
    const res = await recordRoute(request(passed), checkProps);
    expect(res.status).toBe(201);
    expect(recordResult).toHaveBeenCalledWith(
      expect.objectContaining({
        checkId: 'c1',
        recordedBy: `${r}-login`,
        executorId: null,
        result: expect.objectContaining({ status: 'passed', executorName: 'Иванов' }),
      }),
    );
  });

  it('неутверждённая редакция не принимает проверки', async () => {
    asRole('architect');
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue({
      ...approved,
      status: 'under_review',
      reviewStage: 'gap',
    } as never);
    expect((await recordRoute(request(passed), checkProps)).status).toBe(409);
    expect((await seedRoute(request({}), pkgProps)).status).toBe(409);
    const list = await (await listRoute(request(), pkgProps)).json();
    expect(list).toMatchObject({ eligible: false, canRecord: false, pendingSeeds: 0 });
  });

  it('«пройдена» без исполнителя, даты или результата — 400 и без записи', async () => {
    asRole('architect');
    for (const missing of ['executorName', 'executedAt', 'actualResult']) {
      const res = await recordRoute(request({ ...passed, [missing]: '' }), checkProps);
      expect(res.status, missing).toBe(400);
    }
    expect((await recordRoute(request({}), checkProps)).status).toBe(400);
    expect(recordResult).not.toHaveBeenCalled();
  });

  it('executorSelf подставляет вошедшего как исполнителя', async () => {
    asRole('gap');
    const res = await recordRoute(
      request({ ...passed, executorName: undefined, executorSelf: true }),
      checkProps,
    );
    expect(res.status).toBe(201);
    expect(recordResult).toHaveBeenCalledWith(
      expect.objectContaining({
        executorId: 'u-gap',
        result: expect.objectContaining({ executorName: 'gap-login' }),
      }),
    );
  });

  it('проверка из чужого комплекта — 404', async () => {
    asRole('architect');
    vi.mocked(loadCheck).mockResolvedValue(null);
    expect((await recordRoute(request(passed), checkProps)).status).toBe(404);
  });

  it('вложения передаются идентификаторами, а не ключами', async () => {
    asRole('architect');
    const keys = await recordRoute(
      request({ ...passed, evidenceIds: [{ key: 'acceptance/p1/c1/a.pdf' }] }),
      checkProps,
    );
    expect(keys.status).toBe(400);
    const ok = await recordRoute(request({ ...passed, evidenceIds: ['e1'] }), checkProps);
    expect(ok.status).toBe(201);
    expect(recordResult).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceIds: ['e1'], recordedById: 'u-architect' }),
    );
  });

  it('исполнитель-пользователь получает имя из учётной записи; смешивать способы нельзя', async () => {
    asRole('architect');
    const { executorName: _name, ...withoutName } = passed;
    void _name;
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u7', username: 'petrov' } as never);
    const byId = await recordRoute(request({ ...withoutName, executorId: 'u7' }), checkProps);
    expect(byId.status).toBe(201);
    expect(recordResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executorId: 'u7',
        result: expect.objectContaining({ executorName: 'petrov' }),
      }),
    );
    for (const body of [
      { ...passed, executorId: 'u7' },
      { ...passed, executorSelf: true },
      { ...withoutName, executorSelf: true, executorId: 'u7' },
    ]) {
      expect((await recordRoute(request(body), checkProps)).status).toBe(400);
    }
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(
      (await recordRoute(request({ ...withoutName, executorId: 'ghost' }), checkProps)).status,
    ).toBe(400);
  });

  it('загрузка больше лимита отклоняется до разбора multipart', async () => {
    asRole('architect');
    const req = new NextRequest('http://localhost/x', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': '20000000' },
    });
    expect((await evidencePost(req, checkProps)).status).toBe(413);
    expect(uploadEvidence).not.toHaveBeenCalled();
  });

  it('загрузчика вложения фиксирует сервер', async () => {
    asRole('gap');
    vi.mocked(uploadEvidence).mockResolvedValue({ id: 'e1', key: 'k' } as never);
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'p.pdf', { type: 'application/pdf' }));
    const req = new NextRequest('http://localhost/x', { method: 'POST', body: form });
    expect((await evidencePost(req, checkProps)).status).toBe(201);
    expect(uploadEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedBy: 'gap-login', uploadedById: 'u-gap', ext: 'pdf' }),
    );
  });

  it('правка текста замечания: автор/админ решает store, аудит получает прежний текст', async () => {
    asRole('architect');
    vi.mocked(editRemarkText).mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Править замечание может только его автор или администратор',
    });
    expect(
      (await remarkPatch(request({ text: 'новый' }, undefined, 'PATCH'), remarkProps)).status,
    ).toBe(403);
    expect(editRemarkText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'новый',
        actor: expect.objectContaining({ id: 'u-architect', role: 'architect' }),
      }),
    );
  });

  it('засев: пустой снимок — 422, иначе 201', async () => {
    asRole('architect');
    expect((await seedRoute(request({}), pkgProps)).status).toBe(201);
    vi.mocked(seedChecks).mockResolvedValueOnce({ created: 0, total: 0 });
    expect((await seedRoute(request({}), pkgProps)).status).toBe(422);
  });

  it('замечание: неизвестное действие — 400, правило перехода — его статус', async () => {
    asRole('architect');
    expect(
      (await remarkPatch(request({ action: 'delete' }, undefined, 'PATCH'), remarkProps)).status,
    ).toBe(400);
    vi.mocked(transitionRemark).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Замечание снимается только пройденной повторной проверкой',
    });
    expect(
      (await remarkPatch(request({ action: 'verify' }, undefined, 'PATCH'), remarkProps)).status,
    ).toBe(409);
  });

  it('вложение отдаётся только если на него ссылается результат проверки', async () => {
    vi.mocked(findEvidence).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/x?key=acceptance/p1/c1/a.pdf', {
      headers: { 'X-Share-Token': token(['read']) },
    });
    expect((await evidenceGet(req, checkProps)).status).toBe(404);
    expect(findEvidence).toHaveBeenCalledWith('c1', 'acceptance/p1/c1/a.pdf');
  });
});
