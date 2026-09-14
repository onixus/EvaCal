'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

/**
 * Фильтры списков живут в URL: экран серверный, и состояние в адресе даёт
 * ссылку на срез и корректную кнопку «назад». Хук меняет параметры и сразу
 * просит сервер перерисовать страницу — раньше часть экранов после смены
 * фильтра показывала кэшированный список.
 *
 * Любая смена фильтра сбрасывает страницу пагинации: старый номер страницы
 * относился к другому набору строк.
 */
export function useQueryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const get = useCallback((key: string) => searchParams.get(key), [searchParams]);

  const set = useCallback(
    (patch: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') params.delete(key);
        else params.set(key, value);
      }
      if (!opts.keepPage) params.delete('page');
      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        router.refresh();
      });
    },
    [router, pathname, searchParams],
  );

  const reset = useCallback(() => {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
      router.refresh();
    });
  }, [router, pathname]);

  return { get, set, reset, pending };
}
