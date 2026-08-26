'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAppRole, ROLE_HOME } from '@/lib/appRoles';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `next` ставит гейт роли, когда пользователя развернули с закрытой страницы.
  // Без него посадочный экран выбирается по роли: ревьюверу нужна очередь
  // ревью, а не общий список расчётов, которого нет в его навигации.
  const next = searchParams.get('next');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Не удалось войти');
      const role = String(data.role ?? '');
      const home = isAppRole(role) ? ROLE_HOME[role] : '/';
      router.push(data.mustChangePassword ? '/account' : (next ?? home));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Логин</label>
        <input
          className="input"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Пароль</label>
        <input
          type="password"
          className="input"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={submitting}>
        {submitting ? 'Вход…' : 'Войти'}
      </button>
    </form>
  );
}
