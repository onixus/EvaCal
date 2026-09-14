'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Template {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { fields: number; stageTemplates: number; calculations: number };
}

export default function TemplateList({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  async function activate(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/templates/${id}/activate`, { method: 'POST' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function rename(id: string, name: string, currentName: string) {
    setRenamingId(null);
    if (!name.trim() || name === currentName) return;
    setBusy(id);
    try {
      await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/templates/${id}/duplicate`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/admin/${data.id}`);
      } else {
        alert(data.error ?? 'Ошибка запроса');
      }
    } finally {
      setBusy(null);
    }
  }

  if (templates.length === 0) {
    return <p className="p-4 text-xs text-slate-500 dark:text-nord-muted">Пока нет шаблонов.</p>;
  }

  return (
    <table className="table-list">
      <thead>
        <tr>
          <th>Шаблон</th>
          <th>Вопросов</th>
          <th>Этапов</th>
          <th>Расчётов</th>
          <th>Активен</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => (
          <tr key={t.id}>
            <td>
              {renamingId === t.id ? (
                <input
                  className="input w-56"
                  autoFocus
                  defaultValue={t.name}
                  disabled={busy === t.id}
                  onBlur={(e) => rename(t.id, e.target.value, t.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/${t.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {t.name}
                  </Link>
                  <button
                    className="text-xs text-slate-400 hover:text-slate-600"
                    title="Переименовать"
                    onClick={() => setRenamingId(t.id)}
                  >
                    ✎
                  </button>
                </div>
              )}
              {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
            </td>
            <td>{t._count.fields}</td>
            <td>{t._count.stageTemplates}</td>
            <td>{t._count.calculations}</td>
            <td>
              {t.isActive ? (
                <span className="badge bg-emerald-100 text-emerald-700">Активен</span>
              ) : (
                <button
                  className="btn-secondary btn-sm"
                  disabled={busy === t.id}
                  onClick={() => activate(t.id)}
                >
                  Сделать активным
                </button>
              )}
            </td>
            <td>
              <div className="flex items-center gap-2">
                <Link href={`/admin/${t.id}`} className="btn-secondary btn-sm">
                  Редактировать
                </Link>
                <button
                  className="btn-secondary btn-sm"
                  disabled={busy === t.id}
                  onClick={() => duplicate(t.id)}
                >
                  Копировать
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
