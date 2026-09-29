/** Apply committed PostgreSQL migrations; never modify the schema with db push.
 * Used by development, Jenkins and the one-off migrate container.
 * Create new migrations with: npm run db:migrate -- --name <name>.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { resolveDatabaseUrl } from '../lib/databaseUrl';

const env = { ...process.env, DATABASE_URL: resolveDatabaseUrl() };
console.log('[db:sync] PostgreSQL: prisma migrate deploy');
const result = spawnSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env,
});
if (result.error) console.error('Не удалось запустить локальный Prisma CLI. Выполните npm ci.');
process.exit(result.status ?? 1);
