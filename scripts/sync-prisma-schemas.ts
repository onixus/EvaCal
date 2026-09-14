/**
 * Порождает prisma/postgresql/schema.prisma из основной prisma/schema.prisma
 * (см. lib/prismaSchemas.ts).
 *
 *   npx tsx scripts/sync-prisma-schemas.ts          — переписать копию
 *   npx tsx scripts/sync-prisma-schemas.ts --check  — только сверить (код 1 при расхождении)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  POSTGRES_SCHEMA,
  SOURCE_SCHEMA,
  currentPostgresSchema,
  expectedPostgresSchema,
} from '../lib/prismaSchemas';

const check = process.argv.includes('--check');
const expected = expectedPostgresSchema();
if (currentPostgresSchema() === expected) {
  console.log(`${POSTGRES_SCHEMA} актуальна`);
} else if (check) {
  console.error(`${POSTGRES_SCHEMA} отстала от ${SOURCE_SCHEMA}: выполните npm run db:schema:sync`);
  process.exit(1);
} else {
  const target = path.join(process.cwd(), POSTGRES_SCHEMA);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, expected);
  console.log(`${POSTGRES_SCHEMA} обновлена`);
}
