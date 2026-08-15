import { describe, it, expect } from 'vitest';
import { resolveDatabaseUrl } from '../databaseUrl';

describe('resolveDatabaseUrl', () => {
  it('переписывает унаследованный от Prisma 5 путь на актуальный', () => {
    expect(resolveDatabaseUrl('file:./dev.db')).toBe('file:./prisma/dev.db');
    expect(resolveDatabaseUrl('file:dev.db')).toBe('file:./prisma/dev.db');
  });

  it('не трогает пробелы вокруг значения из .env', () => {
    expect(resolveDatabaseUrl('  file:./dev.db  ')).toBe('file:./prisma/dev.db');
  });

  it('оставляет актуальный путь как есть', () => {
    expect(resolveDatabaseUrl('file:./prisma/dev.db')).toBe('file:./prisma/dev.db');
  });

  it('не трогает пути, заданные явно', () => {
    expect(resolveDatabaseUrl('file:/var/lib/evacal/prod.db')).toBe('file:/var/lib/evacal/prod.db');
    expect(resolveDatabaseUrl('file:./prisma/test.db')).toBe('file:./prisma/test.db');
  });

  it('падает, если переменная не задана', () => {
    expect(() => resolveDatabaseUrl(undefined)).toThrow('DATABASE_URL не задан');
    expect(() => resolveDatabaseUrl('')).toThrow('DATABASE_URL не задан');
  });
});
