import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseProvider, resolveDatabaseUrl } from './lib/databaseUrl';

// Схема Prisma 7 фиксирует провайдера, поэтому под каждую СУБД своя копия схемы
// и свой каталог миграций. Копия для PostgreSQL порождается из основной командой
// `npm run db:schema:sync`; тест lib/__tests__/prismaSchemas.test.ts следит,
// чтобы они не разъехались.
const provider = resolveDatabaseProvider();
const schemaDir = provider === 'postgresql' ? path.join('prisma', 'postgresql') : 'prisma';

export default defineConfig({
  schema: path.join(schemaDir, 'schema.prisma'),
  migrations: {
    path: path.join(schemaDir, 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
