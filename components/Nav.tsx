"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Расчёты" },
  { href: "/presale", label: "Пресейл" },
  { href: "/architect", label: "Архитектор" },
  { href: "/admin", label: "Админ" },
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
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setSession(data.session))
      .catch(() => setSession(null));
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    router.push("/");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white dark:border-nord-2 dark:bg-nord-1">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
        <Link
          href="/"
          className="text-lg font-semibold text-brand-700 [text-shadow:0_0_12px_rgba(255,62,165,0.35)] dark:text-nord-frost2 dark:[text-shadow:0_0_12px_rgba(136,192,208,0.4)]"
        >
          EvaCal
        </Link>
        <nav className="flex flex-1 gap-1">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  active
                    ? "bg-brand-50 text-brand-700 shadow-[inset_0_-2px_0_#ff3ea5] dark:bg-nord-2 dark:text-nord-frost2 dark:shadow-[inset_0_-2px_0_#88c0d0]"
                    : "text-slate-600 hover:bg-slate-100 dark:text-nord-4 dark:hover:bg-nord-2"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {session ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 dark:text-nord-3">
              {session.username} · {session.role === "admin" ? "администратор" : "архитектор"}
            </span>
            <button onClick={logout} className="text-rose-600 hover:underline dark:text-nord-red">
              Выйти
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-sm font-medium text-brand-700 hover:underline dark:text-nord-frost2"
          >
            Войти
          </Link>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
