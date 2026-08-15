import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './lib/databaseUrl';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
