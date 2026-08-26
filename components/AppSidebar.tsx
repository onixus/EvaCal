'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { appRoleLabel, canUseDarkFantasy, navItemsFor, type NavItem } from '@/lib/appRoles';
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

interface Session {
  username: string;
  role: string;
}

type BadgeCounts = Partial<Record<NonNullable<NavItem['badgeKey']>, number>>;

const THEME_ROWS: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная (Nord)' },
  { id: 'dark-fantasy', label: 'Dark Fantasy' },
];

/**
 * Активность пункта. `/` — точное совпадение: иначе «Расчёты и сметы»
 * подсвечивались бы на каждом экране приложения.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export default function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [badges, setBadges] = useState<BadgeCounts>({});
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => setSession(data.session))
      .catch(() => setSession(null));
  }, [pathname]);

  // Счётчики — украшение навигации, а не её условие: при ошибке пункты
  // показываются без бейджей, а не исчезают.
  useEffect(() => {
    if (!session) {
      setBadges({});
      return;
    }
    fetch('/api/nav/badges')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setBadges(data?.badges ?? {}))
      .catch(() => setBadges({}));
  }, [session, pathname]);

  useEffect(() => {
    setTheme(resolveTheme());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ theme: Theme }>).detail;
      if (detail?.theme) setTheme(detail.theme);
    };
    window.addEventListener('evacal-theme-change', handler);
    return () => window.removeEventListener('evacal-theme-change', handler);
  }, []);

  const dfAllowed = canUseDarkFantasy(session?.role);

  /**
   * Роль могли понизить, пока Dark Fantasy стояла в localStorage. Сбрасываем на
   * светлую, иначе пользователь остался бы в теме, которую не может переключить
   * обратно: её строка в списке заблокирована.
   */
  useEffect(() => {
    if (!session || dfAllowed || theme !== 'dark-fantasy') return;
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    applyTheme('light');
  }, [session, dfAllowed, theme]);

  function selectTheme(next: Theme) {
    if (next === 'dark-fantasy' && !dfAllowed) return;
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setSession(null);
    router.push('/login');
    router.refresh();
  }

  const navItems = navItemsFor(session?.role);

  return (
    <aside className="hidden shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-nord-3 dark:bg-nord-2">
      <div className="flex h-[var(--app-header-h)] items-center gap-2.5 border-b border-slate-200 px-4 dark:border-nord-3">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-[11px] font-bold text-white transition-colors group-hover:bg-brand-700 dark:bg-nord-frost4">
            EC
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-bold text-slate-900 dark:text-nord-6">EvaCal</span>
            <span className="mt-0.5 text-[10px] font-medium text-slate-400 dark:text-nord-muted">
              Studio
            </span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {navItems.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-slate-400 dark:text-nord-muted">
            Войдите, чтобы увидеть разделы своей роли.
          </p>
        ) : (
          navItems.map((item) => {
            const active = isActive(pathname, item.href);
            const count = item.badgeKey ? badges[item.badgeKey] : undefined;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-nord-3 dark:text-nord-frost2'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-nord-4 dark:hover:bg-nord-3'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? 'bg-brand-600 dark:bg-nord-frost2' : 'bg-slate-300 dark:bg-nord-3'
                  }`}
                />
                <span className="truncate">{item.label}</span>
                {count ? (
                  <span
                    className={`nums ml-auto rounded-full px-1.5 py-px text-[10px] font-extrabold ${
                      active
                        ? 'bg-brand-600 text-white dark:bg-nord-frost4'
                        : 'bg-slate-100 text-slate-500 dark:bg-nord-1 dark:text-nord-muted'
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })
        )}
      </nav>

      <div className="space-y-3 border-t border-slate-200 p-3 dark:border-nord-3">
        <div>
          <div className="label mb-1.5">Тема</div>
          <div className="space-y-0.5">
            {THEME_ROWS.map((row) => {
              const locked = row.id === 'dark-fantasy' && !dfAllowed;
              const active = theme === row.id;

              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectTheme(row.id)}
                  disabled={locked}
                  title={
                    locked
                      ? 'Тему Dark Fantasy включает администратор; доступна ролям Архитектор и Администратор'
                      : undefined
                  }
                  className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-brand-100 bg-brand-50 text-slate-900 dark:border-nord-3 dark:bg-nord-3 dark:text-nord-6'
                      : locked
                        ? 'cursor-not-allowed border-transparent text-slate-400 dark:text-nord-muted'
                        : 'border-transparent text-slate-600 hover:bg-slate-50 dark:text-nord-4 dark:hover:bg-nord-3'
                  }`}
                >
                  <span>{row.label}</span>
                  <span className="text-[10px] font-bold">
                    {locked ? '🔒 админ' : active ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {session ? (
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-nord-1">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold uppercase text-white dark:bg-nord-frost4">
              {session.username.slice(0, 1)}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs font-semibold text-slate-800 dark:text-nord-5">
                {session.username}
              </span>
              <span className="truncate text-[10px] text-slate-400 dark:text-nord-muted">
                {appRoleLabel(session.role)}
              </span>
            </span>
            <button
              type="button"
              onClick={logout}
              className="ml-auto shrink-0 text-[10px] font-semibold text-slate-400 transition-colors hover:text-rose-600 dark:text-nord-muted dark:hover:text-nord-redText"
            >
              Выйти
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="block rounded-lg bg-slate-50 px-2 py-2 text-center text-xs font-semibold text-brand-700 hover:bg-slate-100 dark:bg-nord-1 dark:text-nord-frost2"
          >
            Войти для сотрудников →
          </Link>
        )}
      </div>
    </aside>
  );
}
