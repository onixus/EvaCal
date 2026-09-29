import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDatabaseUrl } from './databaseUrl';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** One lazy client/pool in every environment, including production.
 * Caching and binding methods to the real client are required for interactive
 * transactions; a new client on every proxy access breaks transaction identity.
 */
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const connectionString = resolveDatabaseUrl();
    const schema = new URL(connectionString).searchParams.get('schema') || 'public';
    globalForPrisma.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    });
  }
  return globalForPrisma.prisma;
}

// Importing pure functions that transitively use this module does not require a
// running database. Configuration is validated on the first client access.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
