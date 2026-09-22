'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SerializedProject } from './types';

export interface ProjectFormValues {
  name: string;
  customer: string;
  code: string;
  description: string;
  status: string;
}

function initialValues(project: SerializedProject): ProjectFormValues {
  return {
    name: project.name,
    customer: project.customer,
    code: project.code || '',
    description: project.description || '',
    status: project.status,
  };
}

/**
 * Реквизиты проекта редактируются из вкладки «Параметры» и из модального окна
 * шапки. Форма и запрос у них одни и те же — различается только обрамление и
 * что делать после успешного сохранения.
 */
export default function ProjectForm({
  project,
  submitLabel,
  onSaved,
  footer,
}: {
  project: SerializedProject;
  submitLabel: string;
  onSaved?: () => void;
  footer?: (state: { saving: boolean }) => React.ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProjectFormValues>(() => initialValues(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось обновить проект');
      }
      onSaved?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления проекта');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      <div>
        <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
          Название проекта *
        </label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input text-sm"
        />
      </div>

      <div>
        <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
          Заказчик *
        </label>
        <input
          type="text"
          required
          value={form.customer}
          onChange={(e) => setForm({ ...form, customer: e.target.value })}
          className="input text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
            Код проекта (шифр)
          </label>
          <input
            type="text"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="PRJ-2026-001"
            className="input text-sm font-mono uppercase"
          />
        </div>

        <div>
          <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Статус</label>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="input text-sm"
          >
            <option value="active">Активен</option>
            <option value="on_hold">На паузе</option>
            <option value="completed">Завершён</option>
            <option value="archived">Архив</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
          Описание проекта
        </label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="input text-sm"
        />
      </div>

      {footer ? (
        footer({ saving })
      ) : (
        <div className="pt-2">
          <button type="submit" disabled={saving} className="btn-primary text-xs">
            {saving ? 'Сохранение...' : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
