"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  architect: "Архитектор",
  admin: "Администратор",
};

export default function UsersManager({ users }: { users: User[] }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("architect");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; role: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось создать пользователя");
      setCreated({ username: data.username, role: data.role, password: data.password });
      setUsername("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeUser(user: User) {
    if (!confirm(`Удалить пользователя «${user.username}»?`)) return;
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Не удалось удалить пользователя");
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {created && (
        <div className="card border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-nord-green/50 dark:bg-nord-green/10">
          <p className="font-medium">
            Пользователь «{created.username}» ({ROLE_LABELS[created.role]}) создан.
          </p>
          <p className="mt-1">
            Пароль: <code className="rounded bg-white px-1.5 py-0.5 dark:bg-nord-1">{created.password}</code> —
            показывается один раз, сохраните и передайте пользователю. При первом входе стоит сменить пароль в
            «Аккаунт».
          </p>
          <button className="btn-secondary mt-2" onClick={() => setCreated(null)}>
            Понятно
          </button>
        </div>
      )}

      <div className="card p-6">
        <h2 className="mb-3 font-medium">Новый пользователь</h2>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Логин</label>
            <input className="input" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="label">Роль</label>
            <select className="input w-48" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="architect">Архитектор</option>
              <option value="admin">Администратор</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Создание…" : "Создать"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Существующие пользователи</h2>
        {users.length === 0 ? (
          <p className="text-sm text-slate-500">Пользователей пока нет.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-nord-2 dark:text-nord-3">
                <th className="py-2 pr-4">Логин</th>
                <th className="py-2 pr-4">Роль</th>
                <th className="py-2 pr-4">Пароль</th>
                <th className="py-2 pr-4">Создан</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0 dark:border-nord-2">
                  <td className="py-2 pr-4 font-medium">{u.username}</td>
                  <td className="py-2 pr-4">{ROLE_LABELS[u.role] ?? u.role}</td>
                  <td className="py-2 pr-4 text-slate-500 dark:text-nord-3">
                    {u.mustChangePassword ? "выдан, ещё не менялся" : "изменён пользователем"}
                  </td>
                  <td className="py-2 pr-4 text-slate-500 dark:text-nord-3">
                    {new Date(u.createdAt).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      className="btn-secondary px-2 py-1 text-xs text-rose-600"
                      disabled={busyId === u.id}
                      onClick={() => removeUser(u)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
