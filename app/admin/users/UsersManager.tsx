'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { APP_ROLES } from '@/lib/appRoles';

interface User {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  APP_ROLES.map((r) => [r.value, r.label]),
);

export default function UsersManager({ users }: { users: User[] }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('architect');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    username: string;
    role: string;
    password: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Не удалось создать пользователя');
      setCreated({
        username: data.username,
        role: data.role,
        password: data.password,
      });
      setUsername('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  }

  async function changeRole(user: User, role: string) {
    if (role === user.role) return;
    const label = APP_ROLES.find((r) => r.value === role)?.label ?? role;
    if (!confirm(`Назначить пользователю «${user.username}» роль «${label}»?`)) return;
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Не удалось сменить роль');
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(user: User) {
    if (!confirm(`Удалить пользователя «${user.username}»?`)) return;
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Не удалось удалить пользователя');
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {created && (
        <div className="card border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-nord-green/50 dark:bg-nord-green/10">
          <p className="font-medium">
            Пользователь «{created.username}» ({ROLE_LABELS[created.role]}) создан.
          </p>
          <p className="mt-1">
            Пароль:{' '}
            <code className="rounded bg-white px-1.5 py-0.5 dark:bg-nord-2">
              {created.password}
            </code>{' '}
            — показывается один раз, сохраните и передайте пользователю. При первом входе стоит
            сменить пароль в «Аккаунт».
          </p>
          <button className="btn-secondary mt-2" onClick={() => setCreated(null)}>
            Понятно
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">Новый пользователь</span>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Логин</label>
            <input
              className="input"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Роль</label>
            <select className="input w-64" value={role} onChange={(e) => setRole(e.target.value)}>
              {APP_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Создание…' : 'Создать'}
          </button>
        </form>
        {error && <p className="px-4 pb-4 text-sm text-rose-600">{error}</p>}
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <span className="card-title">Существующие пользователи</span>
        </div>
        {users.length === 0 ? (
          <p className="p-4 text-xs text-slate-500 dark:text-nord-muted">Пользователей пока нет.</p>
        ) : (
          <table className="table-list">
            <thead>
              <tr>
                <th>Логин</th>
                <th>Роль</th>
                <th>Пароль</th>
                <th>Создан</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.username}</td>
                  <td>
                    <select
                      className="input w-56 py-1 text-xs"
                      value={u.role}
                      disabled={busyId === u.id}
                      onChange={(e) => changeRole(u, e.target.value)}
                      aria-label={`Роль пользователя ${u.username}`}
                    >
                      {APP_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                      {!ROLE_LABELS[u.role] && <option value={u.role}>{u.role}</option>}
                    </select>
                  </td>
                  <td className="text-slate-500 dark:text-nord-muted">
                    {u.mustChangePassword ? 'выдан, ещё не менялся' : 'изменён пользователем'}
                  </td>
                  <td className="nums text-slate-500 dark:text-nord-muted">
                    {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td>
                    <button
                      className="btn-secondary btn-sm text-rose-600"
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
