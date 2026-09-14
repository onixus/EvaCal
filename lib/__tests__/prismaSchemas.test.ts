import { describe, it, expect } from 'vitest';
import {
  currentPostgresSchema,
  derivePostgresSchema,
  expectedPostgresSchema,
} from '../prismaSchemas';

describe('prisma schemas', () => {
  it('копия схемы для PostgreSQL не отстала от prisma/schema.prisma', () => {
    // Иначе модель данных разъезжается между СУБД молча: SQLite-стенд видит
    // новое поле, а PostgreSQL-развёртывание — нет.
    expect(currentPostgresSchema()).toBe(expectedPostgresSchema());
  });

  it('меняет только провайдера и путь генерации', () => {
    const src =
      'generator client {\n  output   = "../lib/generated/prisma"\n}\ndatasource db {\n  provider = "sqlite"\n}\nmodel A { id String @id }\n';
    const out = derivePostgresSchema(src);
    expect(out).toContain('provider = "postgresql"');
    expect(out).toContain('output   = "../../lib/generated/prisma"');
    expect(out).toContain('model A { id String @id }');
    expect(out.startsWith('// СГЕНЕРИРОВАНО')).toBe(true);
  });

  it('падает, если исходная схема не похожа на ожидаемую', () => {
    expect(() => derivePostgresSchema('datasource db { provider = "mysql" }')).toThrow();
  });
});
