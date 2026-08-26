'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HarnessAgentMode, PublicHarnessAgent } from '@/lib/gost34/agents/types';

const MODE_LABELS: Record<HarnessAgentMode, string> = {
  review: 'Ревью',
  enrichment: 'Обогащение',
};

interface FormState {
  name: string;
  description: string;
  endpoint: string;
  authToken: string;
  modes: HarnessAgentMode[];
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  endpoint: '',
  authToken: '',
  modes: ['review'],
};

export default function AgentsManager({ isAdmin }: { isAdmin: boolean }) {
  const [agents, setAgents] = useState<PublicHarnessAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch('/api/gost34/agents');
    if (res.ok) {
      const data = await res.json();
      setAgents(data.agents || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/gost34/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Не удалось создать агента');
      return;
    }
    setForm(EMPTY_FORM);
    await reload();
  }

  async function patchAgent(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/gost34/agents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Не удалось обновить агента');
    }
    await reload();
    setBusyId(null);
  }

  async function removeAgent(id: string) {
    if (!confirm('Удалить агента? Историю его запусков восстановить нельзя.')) return;
    setBusyId(id);
    await fetch(`/api/gost34/agents/${id}`, { method: 'DELETE' });
    await reload();
    setBusyId(null);
  }

  async function pingAgent(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/gost34/agents/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ping' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || 'Не удалось запустить проверку связи');
    await reload();
    setBusyId(null);
  }

  function toggleMode(mode: HarnessAgentMode) {
    setForm((f) => ({
      ...f,
      modes: f.modes.includes(mode) ? f.modes.filter((m) => m !== mode) : [...f.modes, mode],
    }));
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="mb-3 font-medium">Подключить агента</h2>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Название</span>
              <input
                className="input w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Например: Нормоконтроль отдела ИБ"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Endpoint (HTTPS)</span>
              <input
                className="input w-full"
                value={form.endpoint}
                onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                placeholder="https://agents.example.ru/evacal"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Bearer-токен (не обязателен)</span>
              <input
                className="input w-full"
                type="password"
                value={form.authToken}
                onChange={(e) => setForm({ ...form, authToken: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Описание</span>
              <input
                className="input w-full"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {(Object.keys(MODE_LABELS) as HarnessAgentMode[]).map((mode) => (
              <label key={mode} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.modes.includes(mode)}
                  onChange={() => toggleMode(mode)}
                />
                {MODE_LABELS[mode]}
              </label>
            ))}
            <button type="submit" className="btn btn-primary ml-auto">
              Подключить
            </button>
          </div>
        </form>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Подключённые агенты</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Загрузка…</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-slate-500">
            Пока нет ни одного агента. Агент — это ваш HTTP-сервис: платформа шлёт ему POST с
            комплектом, а он отвечает JSON с полями findings и patches.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Агент</th>
                {isAdmin && <th className="py-2 pr-4">Владелец</th>}
                <th className="py-2 pr-4">Режимы</th>
                <th className="py-2 pr-4">Последний запуск</th>
                <th className="py-2 pr-4">Действия</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-slate-500">{a.endpoint}</div>
                    {a.description && <div className="text-xs text-slate-500">{a.description}</div>}
                  </td>
                  {isAdmin && <td className="py-2 pr-4 text-slate-600">{a.ownerName}</td>}
                  <td className="py-2 pr-4">
                    {a.modes.map((m) => MODE_LABELS[m]).join(', ')}
                    {!a.enabled && <span className="ml-2 text-xs text-amber-600">выключен</span>}
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-600">
                    {a.lastRunAt ? (
                      <>
                        {new Date(a.lastRunAt).toLocaleString('ru-RU')}
                        <div className={a.lastStatus === 'ok' ? 'text-green-600' : 'text-red-600'}>
                          {a.lastStatus}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        className="btn btn-secondary"
                        disabled={busyId === a.id}
                        onClick={() => pingAgent(a.id)}
                      >
                        Проверить связь
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={busyId === a.id}
                        onClick={() => patchAgent(a.id, { enabled: !a.enabled })}
                      >
                        {a.enabled ? 'Выключить' : 'Включить'}
                      </button>
                      <button
                        className="btn btn-secondary text-red-600"
                        disabled={busyId === a.id}
                        onClick={() => removeAgent(a.id)}
                      >
                        Удалить
                      </button>
                    </div>
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
