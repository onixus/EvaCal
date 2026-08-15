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
