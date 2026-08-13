import { afterEach, describe, expect, it } from 'vitest';
import {
  createShareToken,
  isAnonymousPresaleAllowed,
  verifyShareToken,
} from '@/lib/access';

describe('share tokens', () => {
  afterEach(() => {
    delete process.env.ALLOW_ANONYMOUS_PRESALE;
  });

  it('round-trips a signed share payload', () => {
    process.env.SESSION_SECRET = 'test-secret-for-hmac-share-tokens-32b';
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
    process.env.SESSION_SECRET = 'test-secret-for-hmac-share-tokens-32b';
    const token = createShareToken({
      calculationId: 'calc_1',
      scopes: ['read'],
      ttlSeconds: 60,
    });
    const [data] = token.split('.');
    expect(verifyShareToken(`${data}.deadbeef`)).toBeNull();
  });

  it('rejects expired tokens', () => {
    process.env.SESSION_SECRET = 'test-secret-for-hmac-share-tokens-32b';
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
});
