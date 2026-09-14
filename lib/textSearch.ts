import { resolveDatabaseProvider } from './databaseUrl';

/**
 * Фильтр «подстрока без учёта регистра» для Prisma.
 *
 * В SQLite `contains` идёт через LIKE и для латиницы регистра не различает;
 * в PostgreSQL тот же `contains` — строгий, и поиск «банк» перестал бы
 * находить «Банк». Там нужен `mode: 'insensitive'` (ILIKE), а клиент под
 * SQLite такой опции не знает и отвергнет её на этапе валидации запроса.
 */
export function containsInsensitive(search: string): { contains: string; mode?: 'insensitive' } {
  return resolveDatabaseProvider() === 'postgresql'
    ? { contains: search, mode: 'insensitive' }
    : { contains: search };
}
