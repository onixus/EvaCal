"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold text-brand-700 text-lg">
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
                  active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {session ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">
              {session.username} · {session.role === "admin" ? "администратор" : "архитектор"}
            </span>
            <button onClick={logout} className="text-rose-600 hover:underline">
              Выйти
            </button>
          </div>
        ) : (
          <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
            Войти
          </Link>
        )}
      </div>
    </header>
  );
}
