import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  revokeSession,
  isSessionRevoked,
  clearRevocationsForTesting,
} from '@/lib/auth';

describe('lib/auth session revocation', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-session-token-32bytes-long';
    clearRevocationsForTesting();
  });

  it('creates and verifies a valid session token', () => {
    const user = { id: 'usr_1', username: 'alex', role: 'architect' };
    const token = createSessionToken(user);
    expect(token).toBeDefined();

    const payload = verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe('usr_1');
    expect(payload?.username).toBe('alex');
    expect(payload?.role).toBe('architect');
  });

  it('rejects tampered session tokens', () => {
    const user = { id: 'usr_1', username: 'alex', role: 'architect' };
    const token = createSessionToken(user);
    const [data] = token.split('.');
    expect(verifySessionToken(`${data}.bad_signature`)).toBeNull();
  });

  it('revokes session token and prevents further verification', () => {
    const user = { id: 'usr_2', username: 'admin', role: 'admin' };
    const token = createSessionToken(user);

    expect(verifySessionToken(token)).not.toBeNull();
    expect(isSessionRevoked(token)).toBe(false);

    revokeSession(token);
    expect(isSessionRevoked(token)).toBe(true);
    expect(verifySessionToken(token)).toBeNull();
  });

  it('handles null/undefined/malformed tokens safely', () => {
    expect(isSessionRevoked(null)).toBe(true);
    expect(isSessionRevoked(undefined)).toBe(true);
    expect(isSessionRevoked('invalid_token')).toBe(true);
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
  });
});
