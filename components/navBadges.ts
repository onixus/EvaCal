/**
 * Один запрос счётчиков навигации на переход: шапка и сайдбар монтируются
 * вместе и оба зовут `/api/nav/badges`. Запрос в полёте и свежий ответ
 * (несколько секунд) переиспользуются, поэтому сервер считает очередь один раз.
 */
export type NavBadges = Record<string, number>;

const FRESH_MS = 3_000;
let shared: { at: number; promise: Promise<NavBadges> } | null = null;

export function fetchNavBadges(): Promise<NavBadges> {
  const now = Date.now();
  if (shared && now - shared.at < FRESH_MS) return shared.promise;
  const promise = fetch('/api/nav/badges')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data?.badges ?? {}) as NavBadges)
    .catch(() => ({}) as NavBadges);
  shared = { at: now, promise };
  return promise;
}

/** Сбросить кэш (после «прочитать», чтобы счётчик обновился сразу). */
export function invalidateNavBadges(): void {
  shared = null;
}
