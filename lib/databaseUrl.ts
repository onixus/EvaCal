// Prisma 7 резолвит относительный путь в DATABASE_URL от корня проекта, а не от
// каталога схемы, как это делала Prisma 5. Из-за этого старое значение
// `file:./dev.db` начинает указывать на несуществующую базу в корне репозитория
// вместо prisma/dev.db — молча, с созданием новой пустой базы.
//
// Чтобы обновление не требовало ручной правки .env у каждого разработчика и в
// каждом окружении, старые значения переписываются на актуальный путь здесь.
// Шим можно удалить, когда во всех окружениях будет новое значение.
const LEGACY_URLS = new Set(['file:./dev.db', 'file:dev.db']);
const CURRENT_URL = 'file:./prisma/dev.db';

/**
 * Возвращает актуальный DATABASE_URL, переписывая унаследованные от Prisma 5
 * значения. Бросает, если переменная не задана вовсе.
 */
export function resolveDatabaseUrl(raw: string | undefined = process.env.DATABASE_URL): string {
  if (!raw) throw new Error('DATABASE_URL не задан');
  return LEGACY_URLS.has(raw.trim()) ? CURRENT_URL : raw;
}

/**
 * Поддерживаемые СУБД. Схема Prisma 7 фиксирует провайдера, поэтому под каждую
 * СУБД лежит своя копия схемы (prisma/schema.prisma и prisma/postgresql/schema.prisma),
 * а клиент генерируется под ту, что выбрана на сборке.
 */
export type DatabaseProvider = 'sqlite' | 'postgresql';

export const DATABASE_PROVIDERS: readonly DatabaseProvider[] = ['sqlite', 'postgresql'];

/** Определяет СУБД по схеме URL: `file:` — SQLite, `postgres[ql]:` — PostgreSQL. */
export function databaseProviderFromUrl(url: string): DatabaseProvider {
  const scheme = url.trim().split(':', 1)[0]?.toLowerCase();
  if (scheme === 'file') return 'sqlite';
  if (scheme === 'postgresql' || scheme === 'postgres') return 'postgresql';
  throw new Error(
    `DATABASE_URL с неподдерживаемой схемой «${scheme ?? ''}»: ожидается file:… (SQLite) или postgresql://… (PostgreSQL)`,
  );
}

/**
 * Провайдер для текущего окружения.
 *
 * Явный DATABASE_PROVIDER нужен там, где URL ещё неизвестен, но клиент уже
 * генерируется — на сборке Docker-образа под PostgreSQL. В остальных случаях
 * провайдер выводится из DATABASE_URL, чтобы не держать две переменные в
 * согласованном состоянии вручную.
 */
export function resolveDatabaseProvider(
  env: Record<string, string | undefined> = process.env,
): DatabaseProvider {
  const explicit = env.DATABASE_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    if (!DATABASE_PROVIDERS.includes(explicit as DatabaseProvider)) {
      throw new Error(
        `DATABASE_PROVIDER=${explicit} не поддерживается: допустимы ${DATABASE_PROVIDERS.join(', ')}`,
      );
    }
    return explicit as DatabaseProvider;
  }
  return databaseProviderFromUrl(resolveDatabaseUrl(env.DATABASE_URL));
}
