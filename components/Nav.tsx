'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle';

const LINKS = [
  { href: '/projects', label: 'Проекты' },
  { href: '/', label: 'Все расчёты' },
  { href: '/presale', label: 'Пресейл' },
  { href: '/architect', label: 'Архитектор' },
  { href: '/admin', label: 'Шаблоны' },
];

interface Session {
  username: string;
  role: string;
}

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => setSession(data.session))
      .catch(() => setSession(null));
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setSession(null);
    router.push('/');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-nord-3 dark:bg-nord-2/90">
      <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-sm shadow-sm group-hover:bg-brand-700 transition-colors dark:bg-nord-frost4">
              EC
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold text-slate-900 leading-tight dark:text-nord-6">
                EvaCal
              </span>
              <span className="text-[10px] text-slate-400 font-medium leading-none dark:text-nord-muted">
                Калькулятор & ГОСТ 34
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = link.href === '/' ? pathname === '/' : pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? 'bg-brand-50 text-brand-700 dark:bg-nord-3 dark:text-nord-frost2'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-nord-4 dark:hover:bg-nord-3 dark:hover:text-nord-6'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {session ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-2 pr-3 text-xs dark:bg-nord-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white uppercase dark:bg-nord-frost4">
                  {session.username.slice(0, 1)}
                </span>
                <span className="font-medium text-slate-700 dark:text-nord-5">
                  {session.username}
                </span>
                <span className="rounded bg-slate-200/80 px-1.5 py-0.2 text-[10px] font-medium text-slate-600 uppercase dark:bg-nord-1 dark:text-nord-4">
                  {session.role === 'admin' ? 'Админ' : 'Архитектор'}
                </span>
              </div>
              <button
                onClick={logout}
                className="text-xs font-medium text-slate-500 hover:text-rose-600 transition-colors dark:text-nord-muted dark:hover:text-nord-redText"
              >
                Выйти
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="text-xs font-semibold text-brand-700 hover:text-brand-800 dark:text-nord-frost2"
            >
              Войти для сотрудников →
            </Link>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
