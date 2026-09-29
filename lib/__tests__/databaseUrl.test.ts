import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveDatabaseUrl } from '../databaseUrl';

describe('resolveDatabaseUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    'postgresql://user:secret@localhost:5432/evacal?schema=public',
    'postgres://user:p%40ss@[::1]:5432/evacal?sslmode=require',
    'postgresql://user:pass@db/evacal?schema=custom&sslmode=verify-full&sslrootcert=%2Fcert.pem',
    'postgresql:///evacal?host=/var/run/postgresql',
  ])('preserves PostgreSQL connection parameters: %s', (url) => {
    expect(resolveDatabaseUrl(url)).toBe(url);
    expect(resolveDatabaseUrl(`  ${url}  `)).toBe(url);
  });

  it.each(['', '   ', '\t\n'])('rejects empty configuration', (url) => {
    expect(() => resolveDatabaseUrl(url)).toThrow('DATABASE_URL не задан');
  });

  it.each([
    'file:./local.db', 'file::memory:', 'mysql://user:secret@db/name',
    'https://db/name', 'not-a-url', 'postgresql:dbname', 'postgresql://',
    'postgresql://db', 'postgresql://db/', 'postgresql:///evacal',
    'postgresql://db:invalid/evacal', 'postgresql://db/evacal#fragment',
  ])('rejects unsupported or malformed connections: %s', (url) => {
    expect(() => resolveDatabaseUrl(url)).toThrow('требуется postgresql:// или postgres://');
  });

  it('reads the environment without an implicit database', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => resolveDatabaseUrl()).toThrow('DATABASE_URL не задан');
    vi.stubEnv('DATABASE_URL', ' postgres://user:pass@db/evacal ');
    expect(resolveDatabaseUrl()).toBe('postgres://user:pass@db/evacal');
  });

  it('does not expose credentials in validation errors', () => {
    try {
      resolveDatabaseUrl('mysql://user:TOP_SECRET@db/evacal');
      expect.fail('must reject the connection');
    } catch (error) {
      expect(String(error)).not.toContain('TOP_SECRET');
    }
  });
});
