import { afterEach, describe, expect, it, vi } from 'vitest';
import { containsInsensitive } from '../textSearch';

describe('PostgreSQL text search', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('always requests case-insensitive search without accessing database configuration', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(containsInsensitive('Банк')).toEqual({ contains: 'Банк', mode: 'insensitive' });
  });
});
