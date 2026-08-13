'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DynamicForm, { FormFieldDef } from '@/components/DynamicForm';
import { storeShareToken, withShareHeaders } from '@/lib/shareClient';

interface Template {
  id: string;
  name: string;
  fields: FormFieldDef[];
  defaultStartDate: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewCalculationForm({
  template,
  createShareToken = null,
}: {
  template: Template;
  /** Optional create-scoped share from `?share=` on /presale. */
  createShareToken?: string | null;
}) {
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
      const headers = withShareHeaders(null, { 'Content-Type': 'application/json' });
      if (createShareToken) headers.set('X-Share-Token', createShareToken);
      const res = await fetch('/api/calculations', {
        method: 'POST',
        headers,
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
      if (data.shareToken) {
        storeShareToken(data.id, data.shareToken);
        router.push(`/presale/${data.id}?share=${encodeURIComponent(data.shareToken)}`);
      } else {
        router.push(`/presale/${data.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания расчёта');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 1. Основные параметры */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
          1. Основные параметры проекта
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">
              Название проекта <span className="text-rose-500">*</span>
            </label>
            <input
              className="input"
              required
              placeholder="Например: Модернизация СЭД"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Заказчик <span className="text-rose-500">*</span>
            </label>
            <input
              className="input"
              required
              placeholder="Например: ПАО «Газпром»"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Дата старта проекта
              {startDateLocked && (
                <span className="ml-1 text-[10px] text-slate-400 font-normal">(зафиксирована)</span>
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
      </div>

      {/* 2. Вопросы опросника */}
      <div className="border-t border-slate-200/80 pt-6 dark:border-nord-3">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            2. Параметры шаблона «{template.name}»
          </h3>
          <span className="text-xs text-slate-400">
            {template.fields.length} {template.fields.length === 1 ? 'вопрос' : 'вопросов'}
          </span>
        </div>
        <DynamicForm
          fields={template.fields}
          values={answers}
          onChange={(key, value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:border-nord-red/40 dark:bg-nord-red/15 dark:text-nord-redText">
          {error}
        </div>
      )}

      <div className="border-t border-slate-200/80 pt-4 flex items-center justify-between dark:border-nord-3">
        <p className="text-xs text-slate-500 dark:text-nord-muted">
          После отправки форма рассчитает трудозатраты и построит предварительный план.
        </p>
        <button type="submit" className="btn-primary !px-6 shadow-md" disabled={submitting}>
          {submitting ? 'Выполняется расчёт…' : 'Рассчитать трудозатраты ➔'}
        </button>
      </div>
    </form>
  );
}
