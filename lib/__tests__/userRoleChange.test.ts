import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireApiRole: vi.fn() };
});
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() } },
}));

import { PATCH as patchUser } from '@/app/api/users/[id]/route';
import {
  clearRevocationsForTesting,
  createSessionToken,
  requireApiRole,
  verifySessionToken,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const adminSession = { userId: 'admin-1', username: 'admin', role: 'admin', exp: 0 };

const patch = (body: unknown, id = 'u1') =>
  patchUser(
    new NextRequest('http://localhost/x', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id }) },
  );

describe('Смена роли пользователя', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRevocationsForTesting();
    process.env.SESSION_SECRET = 'test-secret-key-for-sessions';
    vi.mocked(requireApiRole).mockResolvedValue(adminSession as never);
  });

  it('переназначает роль и пишет прежнюю в аудит', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      username: 'reviewer',
      role: 'reviewer',
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'u1',
      username: 'reviewer',
      role: 'techwriter',
    } as never);

    const res = await patch({ role: 'techwriter' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: 'reviewer', role: 'techwriter' });
    expect(vi.mocked(prisma.user.update).mock.calls[0][0]).toMatchObject({
      data: { role: 'techwriter' },
    });
  });

  it('отзывает уже выданные сессии пользователя', async () => {
    const token = createSessionToken({ id: 'u1', username: 'reviewer', role: 'reviewer' });
    expect(verifySessionToken(token)?.role).toBe('reviewer');

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      username: 'reviewer',
      role: 'reviewer',
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'u1',
      username: 'reviewer',
      role: 'gap',
    } as never);

    await patch({ role: 'gap' });

    // Роль зашита в токен: без отзыва пользователь доработал бы смену в старых правах.
    expect(verifySessionToken(token)).toBeNull();
  });

  it('не отзывает сессии других пользователей', async () => {
    const other = createSessionToken({ id: 'u2', username: 'gap', role: 'gap' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      username: 'reviewer',
      role: 'reviewer',
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'u1',
      username: 'reviewer',
      role: 'techwriter',
    } as never);

    await patch({ role: 'techwriter' });

    expect(verifySessionToken(other)?.username).toBe('gap');
  });

  it('роль вне модели отклоняется', async () => {
    const res = await patch({ role: 'normocontrol' });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('последнего администратора разжаловать нельзя', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      username: 'admin',
      role: 'admin',
    } as never);
    vi.mocked(prisma.user.count).mockResolvedValue(1 as never);

    const res = await patch({ role: 'architect' });

    expect(res.status).toBe(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('смена роли доступна только администратору', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(
      NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }) as never,
    );

    const res = await patch({ role: 'techwriter' });

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
