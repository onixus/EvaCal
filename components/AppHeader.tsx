'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { canCreateCalculation, NAV_BY_ROLE, NAV_GROUP_LABELS, navItemsFor } from '@/lib/appRoles';
import { isNavActive } from './AppSidebar';

interface Session {
  username: string;
  role: string;
}

/**
 * Заголовок экрана выводится из адреса, а не передаётся страницей: шапка
 * общая для всего приложения и не должна знать про каждый экран отдельно.
 * Разделы верхнего уровня берутся из навигации (`NAV_BY_ROLE`), чтобы шапка
 * и сайдбар не расходились; здесь только экраны, которых в навигации нет.
 */
const DETAIL_TITLES: [prefix: string, root: string, title: string][] = [
  ['/calculations/', 'Расчёты', 'Рабочее пространство расчёта'],
  ['/presale/', 'Пресейл', 'Расчёт пресейла'],
  ['/review/', 'Ревью', 'Ревью комплекта'],
  ['/projects/', 'Проекты', 'Карточка проекта'],
  ['/architect/', 'Архитектура', 'Редактор архитектора'],
  ['/admin/capacity', 'Администрирование', 'Ёмкость ролей'],
  ['/admin/users', 'Администрирование', 'Пользователи'],
  ['/account', 'Профиль', 'Учётная запись'],
  ['/login', 'EvaCal', 'Вход'],
];

/** Все пункты навигации без повторов; при совпадении href побеждает первая роль. */
const NAV_ROUTES = Object.values(NAV_BY_ROLE)
  .flat()
  .filter((item, i, all) => all.findIndex((x) => x.href === item.href) === i)
  .sort((a, b) => b.href.length - a.href.length);

export function resolveTitle(
  pathname: string | null,
  role?: string | null,
): { root: string; title: string } {
  if (!pathname || pathname === '/') return { root: 'EvaCal', title: 'Рабочий стол' };

  // Студия и лист изменений живут внутри расчёта — у них свои заголовки,
  // иначе они схлопнулись бы в общий «Рабочее пространство расчёта».
  if (pathname.includes('/studio')) return { root: 'Документация', title: 'Студия ГОСТ 34' };
  if (pathname.includes('/changelog')) {
    return { root: 'Документация', title: 'Лист внутренних изменений' };
  }

  const detail = DETAIL_TITLES.find(([prefix]) => pathname.startsWith(prefix));
  if (detail) return { root: detail[1], title: detail[2] };

  // Подпись раздела зависит от роли («Очередь нормоконтроля» у тех.писателя,
  // «Комплекты на подписи» у архитектора) — сперва ищем в её навигации.
  const own = navItemsFor(role).find((item) => item.href !== '/' && pathname.startsWith(item.href));
  const item =
    own ?? NAV_ROUTES.find((route) => route.href !== '/' && pathname.startsWith(route.href));
  return item
    ? { root: NAV_GROUP_LABELS[item.group], title: item.label }
    : { root: 'EvaCal', title: 'Раздел' };
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

  const { root, title } = resolveTitle(pathname, session?.role);
  const navItems = navItemsFor(session?.role);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-nord-3 dark:bg-nord-2/95">
      <div className="flex h-[var(--app-header-h)] items-center justify-between gap-4 px-5 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="hidden text-[11px] font-semibold text-slate-400 sm:inline dark:text-nord-muted">
            {root}
          </span>
          <span className="hidden text-[11px] text-slate-300 sm:inline dark:text-nord-3">/</span>
          <h2 className="truncate text-sm font-bold text-slate-900 dark:text-nord-6">{title}</h2>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canCreateCalculation(session?.role) && (
            <Link href="/presale" className="btn-primary">
              + Новый расчёт
            </Link>
          )}
        </div>
      </div>

      {/*
        На узких экранах сайдбар скрыт, поэтому разделы роли переезжают сюда
        горизонтальной лентой — иначе навигация просто пропала бы.
      */}
      {navItems.length > 0 && (
        <nav
          aria-label="Разделы"
          className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1.5 lg:hidden dark:border-nord-3"
        >
          {navItems.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
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
