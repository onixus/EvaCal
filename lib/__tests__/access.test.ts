import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createShareToken,
  isAnonymousPresaleAllowed,
  resolvePageAccess,
  verifyShareToken,
} from '@/lib/access';

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getSession: vi.fn(async () => null),
  };
});

import { getSession } from '@/lib/auth';

describe('share tokens', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-hmac-share-tokens-32b';
    vi.mocked(getSession).mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.ALLOW_ANONYMOUS_PRESALE;
    vi.mocked(getSession).mockReset();
  });

  it('round-trips a signed share payload', () => {
    const token = createShareToken({
      calculationId: 'calc_1',
      scopes: ['read', 'export'],
      ttlSeconds: 60,
    });
    const payload = verifyShareToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.calculationId).toBe('calc_1');
    expect(payload!.scopes).toContain('export');
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it('rejects tampered tokens', () => {
    const token = createShareToken({
      calculationId: 'calc_1',
      scopes: ['read'],
      ttlSeconds: 60,
    });
    const [data] = token.split('.');
    expect(verifyShareToken(`${data}.deadbeef`)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const token = createShareToken({
      calculationId: 'calc_1',
      scopes: ['read'],
      ttlSeconds: -10,
    });
    expect(verifyShareToken(token)).toBeNull();
  });

  it('parses ALLOW_ANONYMOUS_PRESALE', () => {
    expect(isAnonymousPresaleAllowed()).toBe(false);
    process.env.ALLOW_ANONYMOUS_PRESALE = 'true';
    expect(isAnonymousPresaleAllowed()).toBe(true);
  });

  it('resolvePageAccess allows bound share for read', async () => {
    const token = createShareToken({
      calculationId: 'calc_1',
      scopes: ['read', 'write'],
      ttlSeconds: 60,
    });
    const access = await resolvePageAccess('calc_1', ['read'], token);
    expect(access?.kind).toBe('share');
  });

  it('resolvePageAccess rejects share for another calculation', async () => {
    const token = createShareToken({
      calculationId: 'calc_1',
      scopes: ['read'],
      ttlSeconds: 60,
    });
    const access = await resolvePageAccess('calc_other', ['read'], token);
    expect(access).toBeNull();
  });

  it('resolvePageAccess allows staff session', async () => {
    vi.mocked(getSession).mockResolvedValue({
      userId: 'u1',
      username: 'arch',
      role: 'architect',
      exp: Date.now() + 60_000,
    });
    const access = await resolvePageAccess('calc_1', ['read'], null);
    expect(access?.kind).toBe('staff');
  });

  it('resolvePageAccess denies anonymous without flag', async () => {
    const access = await resolvePageAccess('calc_1', ['read'], null);
    expect(access).toBeNull();
  });
});
