'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

/**
 * Фильтры списков живут в URL: экран серверный, и состояние в адресе даёт
 * ссылку на срез и корректную кнопку «назад». Хук меняет параметры и сразу
 * ведёт на новый адрес; динамическая страница перезапрашивается с сервера.
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
      const target = query ? `${pathname}?${query}` : pathname;
      const current = searchParams.toString() ? `${pathname}?${searchParams}` : pathname;
      startTransition(() => {
        // Динамические страницы Next 15 перезапрашиваются при смене адреса
        // сами (staleTimes.dynamic = 0); refresh нужен только когда адрес не
        // изменился — иначе каждый фильтр рендерил бы страницу дважды.
        if (target === current) router.refresh();
        else router.replace(target, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  const reset = useCallback(() => {
    startTransition(() => {
      if (searchParams.toString()) router.replace(pathname, { scroll: false });
      else router.refresh();
    });
  }, [router, pathname, searchParams]);

  return { get, set, reset, pending };
}
