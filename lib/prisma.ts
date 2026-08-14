import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 требует driver adapter вместо встроенного Rust-движка.
// URL берётся из DATABASE_URL (вида "file:./dev.db"), путь резолвится от prisma/.
function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  return client;
}

// Клиент создаётся при первом обращении, а не при импорте модуля: модули,
// которые тянут lib/prisma транзитивно ради чистых функций, не должны падать
// без DATABASE_URL (например, юнит-тесты).
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = globalForPrisma.prisma ?? createClient();
    return Reflect.get(client, prop, receiver);
  },
});
