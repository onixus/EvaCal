import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/client';
import { databaseProviderFromUrl, resolveDatabaseUrl } from './databaseUrl';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createAdapter(url: string): SqlDriverAdapterFactory {
  const provider = databaseProviderFromUrl(url);
  switch (provider) {
    case 'sqlite':
      return new PrismaBetterSqlite3({ url });
    case 'postgresql':
      return new PrismaPg({ connectionString: url });
  }
}

/**
 * Клиент единственный во всех окружениях.
 *
 * Раньше кэш стоял под `NODE_ENV !== 'production'` — приёмом из шаблонов Next,
 * где кэш нужен, чтобы пережить HMR. Но прокси ниже читает клиента на КАЖДОЕ
 * обращение к свойству, поэтому без кэша в проде каждое обращение создавало
 * новый PrismaClient со своим соединением better-sqlite3.
 *
 * Ломались интерактивные транзакции: `prisma.$transaction` стартовал её на
 * одном соединении, а внутренние обращения движка уходили на новые — Prisma
 * отвечала P2028 «Transaction not found. Transaction ID is invalid». В dev
 * кэш был, и баг не воспроизводился; он жил ровно в проде.
 *
 * Prisma 7 требует driver adapter вместо встроенного Rust-движка. Адаптер
 * выбирается по схеме DATABASE_URL: `file:` — better-sqlite3, `postgresql://` —
 * node-postgres. URL нормализуется: см. lib/databaseUrl.
 */
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const url = resolveDatabaseUrl();
    try {
      globalForPrisma.prisma = new PrismaClient({ adapter: createAdapter(url) });
    } catch (e) {
      // Клиент компилирует SQL под диалект из схемы, поэтому Prisma отказывается
      // подключать его к другой СУБД. Сообщение Prisma говорит про адаптер;
      // здесь добавляется, что именно делать.
      const wanted = databaseProviderFromUrl(url);
      throw new Error(
        `${(e as Error).message}\nPrisma Client собран не под ту СУБД, на которую указывает DATABASE_URL (${wanted}). ` +
          `Пересоберите его: DATABASE_PROVIDER=${wanted} npx prisma generate`,
        { cause: e },
      );
    }
  }
  return globalForPrisma.prisma;
}

// Клиент создаётся при первом обращении, а не при импорте модуля: модули,
// которые тянут lib/prisma транзитивно ради чистых функций, не должны падать
// без DATABASE_URL (например, юнит-тесты).
//
// Методы привязываются к реальному клиенту. Без bind они возвращались
// непривязанными, вызывались с `this` === прокси, и каждый внутренний доступ
// движка к своим полям снова шёл через ловушку get — вторая половина той же
// поломки транзакций.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
