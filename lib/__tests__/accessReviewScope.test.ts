import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createShareToken, verifyShareToken, resolvePageAccess } from '../access';

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getSession: vi.fn(async () => null),
  };
});

describe('Share Scope & Review Permission', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-key-for-share-tokens';
    process.env.SHARE_TOKEN_SECRET = 'test-secret-key-for-share-tokens';
  });

  it('creates and verifies a share token with review scope', () => {
    const token = createShareToken({
      calculationId: 'calc-123',
      scopes: ['review', 'export', 'read'],
      ttlSeconds: 3600,
    });

    const payload = verifyShareToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.calculationId).toBe('calc-123');
    expect(payload!.scopes).toContain('review');
    expect(payload!.scopes).toContain('read');
  });

  it('allows page access for token with review scope', async () => {
    const token = createShareToken({
      calculationId: 'calc-123',
      scopes: ['review'],
      ttlSeconds: 3600,
    });

    const access = await resolvePageAccess('calc-123', ['read'], token);
    expect(access).not.toBeNull();
    expect(access!.kind).toBe('share');
    expect(access!.share?.scopes).toContain('review');
  });

  it('denies write access for token with only review scope', async () => {
    const token = createShareToken({
      calculationId: 'calc-123',
      scopes: ['review', 'read'],
      ttlSeconds: 3600,
    });

    const access = await resolvePageAccess('calc-123', ['write'], token);
    expect(access).toBeNull();
  });
});
