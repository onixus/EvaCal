/**
 * Приводит схему БД к текущей модели — единая точка для локального стенда,
 * Jenkins и контейнера `migrate`.
 *
 * SQLite — встраиваемая база одного стенда: схема синхронизируется через
 * `prisma db push`, как и раньше (истории миграций у SQLite нет).
 * PostgreSQL — общая база с историей: применяются версионированные миграции
 * из prisma/postgresql/migrations через `prisma migrate deploy`.
 *
 * Новую миграцию для PostgreSQL после правки prisma/schema.prisma создаёт
 * `npm run db:migrate:pg -- --name <имя>` (нужен DATABASE_URL на PostgreSQL).
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { resolveDatabaseProvider } from '../lib/databaseUrl';

const provider = resolveDatabaseProvider();
const args = provider === 'postgresql' ? ['migrate', 'deploy'] : ['db', 'push'];
console.log(`[db:sync] ${provider}: prisma ${args.join(' ')}`);
const res = spawnSync('npx', ['prisma', ...args], { stdio: 'inherit', env: process.env });
process.exit(res.status ?? 1);
