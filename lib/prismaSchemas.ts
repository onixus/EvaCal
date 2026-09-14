import fs from 'node:fs';
import path from 'node:path';

/**
 * Схема Prisma 7 фиксирует провайдера, а клиент компилирует SQL под его
 * диалект, поэтому под каждую СУБД нужна своя копия схемы. Чтобы модель данных
 * оставалась одна, копия для PostgreSQL не правится руками: она порождается из
 * основной (`npm run db:schema:sync`), а тест следит, чтобы копия не отстала.
 */
export const SOURCE_SCHEMA = path.join('prisma', 'schema.prisma');
export const POSTGRES_SCHEMA = path.join('prisma', 'postgresql', 'schema.prisma');

const HEADER = `// СГЕНЕРИРОВАНО из prisma/schema.prisma — не править руками.
// Пересобрать: npm run db:schema:sync
`;

/** Преобразует текст SQLite-схемы в эквивалентную схему для PostgreSQL. */
export function derivePostgresSchema(source: string): string {
  const body = source
    // Путь output относителен файла схемы: копия лежит на уровень глубже.
    .replace(
      /output\s*=\s*"\.\.\/lib\/generated\/prisma"/,
      'output   = "../../lib/generated/prisma"',
    )
    .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  if (!body.includes('provider = "postgresql"') || !body.includes('"../../lib/generated/prisma"')) {
    throw new Error(
      'prisma/schema.prisma: не нашёл provider = "sqlite" или output — derivePostgresSchema устарел',
    );
  }
  return HEADER + body;
}

export function expectedPostgresSchema(root = process.cwd()): string {
  return derivePostgresSchema(fs.readFileSync(path.join(root, SOURCE_SCHEMA), 'utf8'));
}

export function currentPostgresSchema(root = process.cwd()): string {
  const target = path.join(root, POSTGRES_SCHEMA);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
}
