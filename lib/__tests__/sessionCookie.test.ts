import { afterEach, describe, expect, it } from 'vitest';
import { isPlainLocalRequest, sessionCookieOptions } from '../access';

const req = (url: string, headers: Record<string, string> = {}) => ({
  url,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
});

const env = process.env as Record<string, string | undefined>;
const originalEnv = env.NODE_ENV;
const originalForce = env.FORCE_SECURE_COOKIES;
const originalLocal = env.EVACAL_LOCAL_HTTP;

afterEach(() => {
  env.NODE_ENV = originalEnv;
  env.FORCE_SECURE_COOKIES = originalForce;
  env.EVACAL_LOCAL_HTTP = originalLocal;
});

describe('isPlainLocalRequest: локальный стенд без TLS', () => {
  it('localhost и 127.0.0.1 по http — локальные', () => {
    expect(isPlainLocalRequest(req('http://localhost:3000/api/auth/login'))).toBe(true);
    expect(isPlainLocalRequest(req('http://127.0.0.1/api/auth/login'))).toBe(true);
  });

  it('https, чужой хост и прокси с https — не локальные', () => {
    expect(isPlainLocalRequest(req('https://localhost/api'))).toBe(false);
    expect(isPlainLocalRequest(req('http://evacal.corp/api'))).toBe(false);
    expect(
      isPlainLocalRequest(req('http://localhost:3000/api', { 'x-forwarded-proto': 'https' })),
    ).toBe(false);
  });
});

describe('sessionCookieOptions: флаг Secure', () => {
  it('в development cookie не Secure', () => {
    env.NODE_ENV = 'development';
    delete env.FORCE_SECURE_COOKIES;
    expect(sessionCookieOptions(10, req('http://localhost:3000/x')).secure).toBe(false);
  });

  it('в production Secure везде, кроме plain-http localhost', () => {
    env.NODE_ENV = 'production';
    delete env.FORCE_SECURE_COOKIES;
    expect(sessionCookieOptions(10, req('https://evacal.corp/x')).secure).toBe(true);
    expect(sessionCookieOptions(10, req('http://evacal.corp/x')).secure).toBe(true);
    expect(sessionCookieOptions(10).secure).toBe(true);
    expect(sessionCookieOptions(10, req('http://localhost:3000/x')).secure).toBe(false);
  });

  it('FORCE_SECURE_COOKIES отменяет исключение для localhost', () => {
    env.NODE_ENV = 'production';
    env.FORCE_SECURE_COOKIES = 'true';
    expect(sessionCookieOptions(10, req('http://localhost:3000/x')).secure).toBe(true);
  });
});

describe('standalone behind local nginx', () => {
  it('permits HTTP only for an explicitly configured local installation', () => {
    env.NODE_ENV = 'production';
    delete env.FORCE_SECURE_COOKIES;
    const request = req('http://0.0.0.0:3000/api/auth/login', { host: '127.0.0.1:8080', 'x-forwarded-proto': 'http' });
    delete env.EVACAL_LOCAL_HTTP;
    expect(sessionCookieOptions(10, request).secure).toBe(true);
    env.EVACAL_LOCAL_HTTP = 'true';
    expect(sessionCookieOptions(10, request).secure).toBe(false);
    env.FORCE_SECURE_COOKIES = 'true';
    expect(sessionCookieOptions(10, request).secure).toBe(true);
  });
  it('does not downgrade TLS, remote hosts, or malformed authorities', () => {
    env.EVACAL_LOCAL_HTTP = 'true';
    for (const host of ['example.com', 'localhost.evil', 'localhost@evil', '127.0.0.1,evil', '']) {
      expect(isPlainLocalRequest(req('http://0.0.0.0:3000/api', { host, 'x-forwarded-proto': 'http' }))).toBe(false);
    }
    for (const proto of ['https', 'https,http', '']) {
      expect(isPlainLocalRequest(req('http://0.0.0.0:3000/api', { host: 'localhost', 'x-forwarded-proto': proto }))).toBe(false);
    }
    expect(isPlainLocalRequest(req('https://0.0.0.0/api', { host: 'localhost', 'x-forwarded-proto': 'http' }))).toBe(false);
    expect(isPlainLocalRequest(req('http://public.example/api', { host: 'localhost', 'x-forwarded-proto': 'http' }))).toBe(false);
  });
});
