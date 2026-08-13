'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DynamicForm, { FormFieldDef } from '@/components/DynamicForm';
import { storeShareToken } from '@/lib/shareClient';

interface Template {
  id: string;
  name: string;
  fields: FormFieldDef[];
  defaultStartDate: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewCalculationForm({ template }: { template: Template }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [startDate, setStartDate] = useState(template.defaultStartDate?.slice(0, 10) ?? todayIso());
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startDateLocked = !!template.defaultStartDate;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/calculations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          customer,
          templateId: template.id,
          answers,
          startDate,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Не удалось создать расчёт');
      }
      const data = await res.json();
      if (data.shareToken) storeShareToken(data.id, data.shareToken);
      router.push(`/presale/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Название проекта</label>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Заказчик</label>
          <input
            className="input"
            required
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
        </div>
        <div>
          <label className="label">
            Дата старта проекта
            {startDateLocked && (
              <span className="ml-1 text-xs text-slate-400">(зафиксирована шаблоном)</span>
            )}
          </label>
          <input
            type="date"
            className="input"
            required
            disabled={startDateLocked}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-700">Опросник «{template.name}»</h3>
        <DynamicForm
          fields={template.fields}
          values={answers}
          onChange={(key, value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
        />
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? 'Расчёт…' : 'Рассчитать трудозатраты'}
      </button>
    </form>
  );
}
