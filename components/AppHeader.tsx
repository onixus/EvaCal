'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { navItemsFor } from '@/lib/appRoles';

interface Session {
  username: string;
  role: string;
}

/**
 * Заголовок экрана выводится из адреса, а не передаётся страницей: шапка
 * общая для всего приложения и не должна знать про каждый экран отдельно.
 * Порядок важен — более длинные префиксы проверяются первыми.
 */
const TITLES: [prefix: string, root: string, title: string][] = [
  ['/calculations/', 'Расчёты', 'Рабочее пространство расчёта'],
  ['/presale', 'Пресейл', 'Пресейл-мастер'],
  ['/review', 'Ревью', 'Ревью документации'],
  ['/changelog', 'Документация', 'Лист внутренних изменений'],
  ['/studio', 'Документация', 'Студия ГОСТ 34'],
  ['/standards', 'Документация', 'Чек-листы и стандарты'],
  ['/projects', 'Проекты', 'Проекты'],
  ['/architect', 'Архитектура', 'Архитектурный каталог'],
  ['/admin', 'Администрирование', 'Шаблоны и пользователи'],
  ['/account', 'Профиль', 'Учётная запись'],
];

function resolveTitle(pathname: string | null): { root: string; title: string } {
  if (!pathname || pathname === '/') return { root: 'Раздел', title: 'Расчёты и сметы' };

  // Студия и лист изменений живут внутри расчёта — у них свои заголовки,
  // иначе они схлопнулись бы в общий «Рабочее пространство расчёта».
  if (pathname.includes('/studio')) return { root: 'Документация', title: 'Студия ГОСТ 34' };
  if (pathname.includes('/changelog')) {
    return { root: 'Документация', title: 'Лист внутренних изменений' };
  }

  const match = TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return match ? { root: match[1], title: match[2] } : { root: 'Раздел', title: 'EvaCal' };
}

export default function AppHeader() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => setSession(data.session))
      .catch(() => setSession(null));
  }, [pathname]);

  const { root, title } = resolveTitle(pathname);
  const navItems = navItemsFor(session?.role);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-nord-3 dark:bg-nord-2/95">
      <div className="flex h-[var(--app-header-h)] items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="hidden text-[11px] font-semibold text-slate-400 sm:inline dark:text-nord-muted">
            {root}
          </span>
          <span className="hidden text-[11px] text-slate-300 sm:inline dark:text-nord-3">/</span>
          <h1 className="truncate text-sm font-bold text-slate-900 dark:text-nord-6">{title}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/presale" className="btn-primary !px-3 !py-1.5 !text-xs">
            + Новый расчёт
          </Link>
        </div>
      </div>

      {/*
        На узких экранах сайдбар скрыт, поэтому разделы роли переезжают сюда
        горизонтальной лентой — иначе навигация просто пропала бы.
      */}
      {navItems.length > 0 && (
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1.5 lg:hidden dark:border-nord-3">
          {navItems.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' : Boolean(pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-nord-3 dark:text-nord-frost2'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-nord-4 dark:hover:bg-nord-3'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
