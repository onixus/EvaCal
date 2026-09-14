import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const cookieStore = { value: undefined as string | undefined };

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'evacal_session' && cookieStore.value ? { value: cookieStore.value } : undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  createSessionToken,
  verifySessionToken,
  requireApiRole,
  requireRole,
  PASSWORD_CHANGE_REQUIRED_CODE,
  clearRevocationsForTesting,
} from '@/lib/auth';
import { requireStaff, requireInternalRole, getStaffSession } from '@/lib/access';

describe('mustChangePassword gate', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-session-token-32bytes-long';
    clearRevocationsForTesting();
    cookieStore.value = undefined;
  });

  const fresh = { id: 'usr_1', username: 'admin', role: 'admin', mustChangePassword: true };
  const settled = { id: 'usr_1', username: 'admin', role: 'admin', mustChangePassword: false };

  it('carries the flag in the token only while the password is unchanged', () => {
    expect(verifySessionToken(createSessionToken(fresh))?.mustChangePassword).toBe(true);
    expect(verifySessionToken(createSessionToken(settled))?.mustChangePassword).toBeUndefined();
  });

  it('API gates answer 403 password_change_required for an unchanged seed password', async () => {
    cookieStore.value = createSessionToken(fresh);
    for (const gate of [
      () => requireApiRole(['admin']),
      () => requireStaff(),
      () => requireInternalRole(['read']),
    ]) {
      const res = await gate();
      expect(res).toBeInstanceOf(NextResponse);
      const body = await (res as NextResponse).json();
      expect((res as NextResponse).status).toBe(403);
      expect(body.code).toBe(PASSWORD_CHANGE_REQUIRED_CODE);
    }
    expect(await getStaffSession()).toBeNull();
  });

  it('lets the same user through once the password was changed', async () => {
    cookieStore.value = createSessionToken(settled);
    const res = await requireApiRole(['admin']);
    expect(res).not.toBeInstanceOf(NextResponse);
    expect((await requireStaff()) as any).toMatchObject({ username: 'admin' });
  });

  it('page guard redirects to /account instead of rendering', async () => {
    cookieStore.value = createSessionToken(fresh);
    await expect(requireRole('admin')).rejects.toThrow('REDIRECT:/account');
  });
});
