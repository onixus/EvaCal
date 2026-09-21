'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SerializedProject } from './types';

export default function ProjectEditModal({
  project,
  onClose,
}: {
  project: SerializedProject;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: project.name,
    customer: project.customer,
    code: project.code || '',
    description: project.description || '',
    status: project.status,
  });
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
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления проекта');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="card w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">Редактировать проект</h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">Изменение реквизитов и статуса проекта</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold" aria-label="Закрыть" />
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}
          <div>
            <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Название проекта *</label>
            <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input text-sm" />
          </div>
          <div>
            <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Заказчик *</label>
            <input type="text" required value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} className="input text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Код проекта (шифр)</label>
              <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="PRJ-2026-001" className="input text-sm font-mono uppercase" />
            </div>
            <div>
              <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Статус</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input text-sm">
                <option value="active">Активен</option>
                <option value="on_hold">На паузе</option>
                <option value="completed">Завершён</option>
                <option value="archived">Архив</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Описание проекта</label>
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input text-sm" />
          </div>
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-nord-3">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">Отмена</button>
            <button type="submit" disabled={saving} className="btn-primary text-xs">{saving ? 'Сохранение...' : 'Сохранить'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
