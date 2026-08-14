'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DynamicForm, { FormFieldDef } from '@/components/DynamicForm';
import { storeShareToken, withShareHeaders } from '@/lib/shareClient';

export interface TemplateDef {
  id: string;
  name: string;
  description?: string | null;
  fields: FormFieldDef[];
  defaultStartDate: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewCalculationForm({
  template,
  availableTemplates = [],
  createShareToken = null,
}: {
  template: TemplateDef;
  availableTemplates?: TemplateDef[];
  /** Optional create-scoped share from `?share=` on /presale. */
  createShareToken?: string | null;
}) {
  const router = useRouter();
  const [selectedTemplateId, setSelectedTemplateId] = useState(template.id);
  const currentTemplate = availableTemplates.find((t) => t.id === selectedTemplateId) || template;

  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [startDate, setStartDate] = useState(
    currentTemplate.defaultStartDate?.slice(0, 10) ?? todayIso(),
  );
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startDateLocked = !!currentTemplate.defaultStartDate;

  function handleTemplateChange(newId: string) {
    setSelectedTemplateId(newId);
    setAnswers({});
  }

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
          templateId: currentTemplate.id,
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
      {/* Шаблон опросника */}
      {availableTemplates.length > 1 && (
        <div className="space-y-2 border-b border-slate-200/80 pb-5 dark:border-nord-3">
          <label className="label text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Выбор отраслевого шаблона
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {availableTemplates.map((tmpl) => {
              const isSelected = tmpl.id === currentTemplate.id;
              return (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => handleTemplateChange(tmpl.id)}
                  className={`p-3 rounded-lg text-left border transition-all text-xs flex flex-col justify-between ${
                    isSelected
                      ? 'border-brand-600 bg-brand-50/50 text-brand-900 ring-1 ring-brand-600 dark:bg-brand-950/40 dark:text-brand-200 dark:border-brand-500'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-nord-dark text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="font-semibold">{tmpl.name}</span>
                  {tmpl.description && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {tmpl.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
              placeholder="Например: Внедрение NGFW и СЗИ в головном офисе"
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
              placeholder="Например: ПАО «Банк Финанс»"
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
            2. Параметры опросника «{currentTemplate.name}»
          </h3>
          <span className="text-xs text-slate-400">
            {currentTemplate.fields.length}{' '}
            {currentTemplate.fields.length === 1 ? 'вопрос' : 'вопросов'}
          </span>
        </div>
        <DynamicForm
          fields={currentTemplate.fields}
          values={answers}
          onChange={(key, value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:border-nord-red/40 dark:bg-nord-red/15 dark:text-nord-redText">
          {error}
        </div>
      )}

      <div className="border-t border-slate-200/80 pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 dark:border-nord-3">
        <p className="text-xs text-slate-500 dark:text-nord-muted">
          После отправки форма рассчитает трудозатраты и построит предварительный план.
        </p>
        <button type="submit" className="btn-primary !px-6 shadow-md" disabled={submitting}>
          {submitting ? 'Создание расчёта...' : 'Рассчитать трудозатраты'}
        </button>
      </div>
    </form>
  );
}
