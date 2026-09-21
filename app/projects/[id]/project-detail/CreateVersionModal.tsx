'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SerializedCalculation } from './types';

export default function CreateVersionModal({
  calculation,
  onClose,
}: {
  calculation: SerializedCalculation;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(`${calculation.name} (v${calculation.version + 1})`);
  const [comment, setComment] = useState(`Новая редакция на основе v${calculation.version}`);
  const [creating, setCreating] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch(`/api/calculations/${calculation.id}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, versionComment: comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось создать версию расчёта');
      }
      const data = await res.json();
      onClose();
      router.push(`/calculations/${data.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка создания версии');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="card w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">Создать версию расчёта (v{calculation.version + 1})</h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">Клонирование сметы с сохранением этапов и рисков</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold" aria-label="Закрыть" />
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Название версии</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="input text-sm" />
          </div>
          <div>
            <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">Комментарий к версии</label>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="например, Оптимистичный сценарий без рискового буфера" className="input text-sm" />
          </div>
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-nord-3">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">Отмена</button>
            <button type="submit" disabled={creating} className="btn-primary text-xs">{creating ? 'Создание...' : 'Создать версию'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
