import { describe, expect, it } from 'vitest';
import { actorTypeFromAccess, clientIp } from '../audit';

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe('clientIp', () => {
  it('prefers X-Real-IP, which the proxy overwrites', () => {
    expect(clientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('ignores a client-supplied X-Forwarded-For prefix', () => {
    // nginx uses $proxy_add_x_forwarded_for: it keeps whatever the caller sent and appends
    // the real peer. Trusting the first entry would let the caller pick the address that
    // gets recorded against their own failed logins.
    const spoofed = req({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': '1.2.3.4, 203.0.113.7',
    });
    expect(clientIp(spoofed)).toBe('203.0.113.7');
  });

  it('falls back to the last hop of the chain, not the first', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('handles padding and empty segments', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4 ,  , 198.51.100.9 ' }))).toBe('198.51.100.9');
    expect(clientIp(req({ 'x-forwarded-for': '' }))).toBeNull();
    expect(clientIp(req({}))).toBeNull();
  });
});

describe('actorTypeFromAccess', () => {
  it('maps access kinds onto audit actor types', () => {
    expect(actorTypeFromAccess('staff')).toBe('user');
    expect(actorTypeFromAccess('share')).toBe('share');
    expect(actorTypeFromAccess('anonymous')).toBe('anonymous');
  });
});
