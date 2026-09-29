import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './lib/databaseUrl';

// One authoritative schema and one immutable migration history for all environments.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
