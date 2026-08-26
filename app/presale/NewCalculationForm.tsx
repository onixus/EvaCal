'use client';

import { useEffect, useMemo, useState } from 'react';
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

/** Живая оценка, которую считает `/api/calculations/preview`. */
interface EstimatePreview {
  totalHours: number;
  stageCount: number;
  calendarDays: number;
  roleCount: number;
  currencySymbol: string;
  priceTotal: number;
  fieldCount: number;
  answeredCount: number;
  stages: {
    name: string;
    roleLabel: string;
    hours: number;
    days: number;
    isApprovalTask: boolean;
  }[];
}

const STEPS = [
  { n: 1, label: 'Параметры' },
  { n: 2, label: 'Опросник' },
  { n: 3, label: 'Итог' },
] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Крупные суммы в сводке читаются в миллионах — точность до рубля тут не нужна. */
function formatMoney(value: number, symbol: string): string {
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(2).replace('.', ',')} млн ${symbol}`;
  if (value >= 1_000) return `${Math.round(value / 1000)} тыс. ${symbol}`;
  return `${Math.round(value)} ${symbol}`;
}

/**
 * Пресейл-мастер в три шага: параметры → опросник → итог.
 *
 * Прежняя форма была одной длинной простынёй, где итоговые трудозатраты
 * появлялись только после отправки. Здесь оценка пересчитывается по мере
 * ответов и стоит в стикки-сводке справа: пресейл видит цену вопроса до того,
 * как создаст расчёт.
 */
export default function NewCalculationForm({
  template,
  availableTemplates = [],
  createShareToken = null,
  initialProjectId = null,
  initialProjectName = '',
  initialCustomer = '',
}: {
  template: TemplateDef;
  availableTemplates?: TemplateDef[];
  /** Optional create-scoped share from `?share=` on /presale. */
  createShareToken?: string | null;
  initialProjectId?: string | null;
  initialProjectName?: string;
  initialCustomer?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState(template.id);
  const currentTemplate = availableTemplates.find((t) => t.id === selectedTemplateId) || template;

  const [name, setName] = useState(initialProjectName);
  const [customer, setCustomer] = useState(initialCustomer);
  const [startDate, setStartDate] = useState(
    currentTemplate.defaultStartDate?.slice(0, 10) ?? todayIso(),
  );
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estimate, setEstimate] = useState<EstimatePreview | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  const startDateLocked = !!currentTemplate.defaultStartDate;
  const answersKey = JSON.stringify(answers);

  /**
   * Оценка считается на сервере теми же движками, что и настоящий расчёт.
   * Debounce в 400 мс — чтобы набор числа в поле не порождал запрос на символ.
   */
  useEffect(() => {
    let cancelled = false;
    setIsEstimating(true);

    const timer = setTimeout(async () => {
      try {
        const headers = withShareHeaders(null, { 'Content-Type': 'application/json' });
        if (createShareToken) headers.set('X-Share-Token', createShareToken);

        const res = await fetch('/api/calculations/preview', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            templateId: currentTemplate.id,
            answers: JSON.parse(answersKey),
            startDate,
          }),
        });
        if (!res.ok || cancelled) return;
        setEstimate((await res.json()) as EstimatePreview);
      } catch {
        // Сводка — вспомогательная: молча оставляем прежние цифры, а не
        // роняем форму, в которой пресейл уже что-то набрал.
      } finally {
        if (!cancelled) setIsEstimating(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTemplate.id, answersKey, startDate, createShareToken]);

  function handleTemplateChange(newId: string) {
    setSelectedTemplateId(newId);
    setAnswers({});
  }

  const progress = useMemo(() => {
    if (!estimate || estimate.fieldCount === 0) return 0;
    return Math.round((estimate.answeredCount / estimate.fieldCount) * 100);
  }, [estimate]);

  const canLeaveStep1 = name.trim().length > 0 && customer.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // На шагах 1-2 та же кнопка ведёт вперёд, а не создаёт расчёт.
    if (step < 3) {
      if (step === 1 && !canLeaveStep1) return;
      setStep((s) => (s + 1) as 1 | 2 | 3);
      return;
    }

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
          projectId: initialProjectId || undefined,
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
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
            Новый расчёт пресейла
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
            Три шага: параметры → опросник → итог. Трудозатраты считаются по мере ответов.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {STEPS.map((s) => {
            const active = step === s.n;
            const done = step > s.n;
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => {
                  // Вперёд через незаполненные обязательные поля не пускаем,
                  // назад — всегда: правка ответов не должна требовать отмены.
                  if (s.n > 1 && !canLeaveStep1) return;
                  setStep(s.n);
                }}
                className={`flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-nord-frost4 dark:bg-nord-frost4'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-4'
                }`}
              >
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-extrabold ${
                    active
                      ? 'bg-white/20 text-white'
                      : done
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-nord-green/20 dark:text-nord-green'
                        : 'bg-slate-100 text-slate-400 dark:bg-nord-1 dark:text-nord-muted'
                  }`}
                >
                  {done ? '✓' : s.n}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>

        {/* ---------- Шаг 1: параметры ---------- */}
        {step === 1 && (
          <div className="card-flat space-y-4 p-5">
            {availableTemplates.length > 1 && (
              <div className="space-y-2">
                <span className="label">Отраслевой шаблон</span>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {availableTemplates.map((tmpl) => {
                    const isSelected = tmpl.id === currentTemplate.id;
                    return (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => handleTemplateChange(tmpl.id)}
                        className={`flex flex-col rounded-[10px] border p-3 text-left text-xs transition-colors ${
                          isSelected
                            ? 'border-brand-600 bg-brand-50 text-brand-900 ring-1 ring-inset ring-brand-600 dark:bg-nord-3 dark:text-nord-frost2'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-4'
                        }`}
                      >
                        <span className="font-bold">{tmpl.name}</span>
                        {tmpl.description && (
                          <span className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-nord-muted">
                            {tmpl.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                  Дата старта
                  {startDateLocked && (
                    <span className="ml-1 font-normal text-slate-400">(зафиксирована)</span>
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
              <div>
                <label className="label">Привязка к проекту</label>
                <input
                  className="input"
                  disabled
                  value={
                    initialProjectId
                      ? `${initialProjectName || 'Выбранный проект'}${initialCustomer ? ` (${initialCustomer})` : ''}`
                      : 'Без привязки'
                  }
                />
              </div>
            </div>
          </div>
        )}

        {/* ---------- Шаг 2: опросник ---------- */}
        {step === 2 && (
          <div className="card-flat space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-nord-6">
                Опросник «{currentTemplate.name}» · {currentTemplate.fields.length}{' '}
                {currentTemplate.fields.length === 1 ? 'вопрос' : 'вопросов'}
              </span>
              <span className="nums text-[11px] font-semibold text-slate-500 dark:text-nord-muted">
                заполнено {estimate?.answeredCount ?? 0} из{' '}
                {estimate?.fieldCount ?? currentTemplate.fields.length}
              </span>
            </div>

            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-nord-1">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-300 dark:bg-nord-frost4"
                style={{ width: `${progress}%` }}
              />
            </div>

            <DynamicForm
              fields={currentTemplate.fields}
              values={answers}
              onChange={(key, value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
            />

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed dark:border-nord-yellow/40 dark:bg-nord-yellow/10">
              <span className="font-extrabold text-amber-800 dark:text-nord-yellow">
                Влияет на оценку:
              </span>{' '}
              <span className="text-amber-900/90 dark:text-nord-yellow/90">
                значения-драйверы шаблона меняют часы этапов и состав ролей — сводка справа
                пересчитывается сразу.
              </span>
            </div>
          </div>
        )}

        {/* ---------- Шаг 3: итог ---------- */}
        {step === 3 && (
          <div className="card-flat space-y-3 p-5">
            <span className="text-xs font-bold text-slate-900 dark:text-nord-6">
              Итог: этапы и роли
            </span>

            {!estimate || estimate.stages.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-nord-muted">
                {isEstimating ? 'Идёт расчёт…' : 'Ответьте на вопросы опросника — появятся этапы.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-nord-3">
                      {['Этап', 'Роль', 'Часы', 'Дней'].map((h, i) => (
                        <th
                          key={h}
                          className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted ${
                            i >= 2 ? 'text-right' : ''
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
                    {estimate.stages.map((stage, idx) => (
                      <tr key={`${stage.name}-${idx}`}>
                        <td className="px-2 py-2 font-semibold text-slate-800 dark:text-nord-5">
                          {stage.name}
                          {stage.isApprovalTask && (
                            <span className="ml-1.5 chip-muted">согласование</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-slate-600 dark:text-nord-4">
                          {stage.roleLabel}
                        </td>
                        <td className="nums px-2 py-2 text-right font-semibold text-slate-900 dark:text-nord-6">
                          {stage.hours}
                        </td>
                        <td className="nums px-2 py-2 text-right text-slate-600 dark:text-nord-4">
                          {stage.days}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:border-nord-red/40 dark:bg-nord-red/15 dark:text-nord-redText">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3)}
            className={`btn-secondary !text-xs ${step === 1 ? 'invisible' : ''}`}
          >
            ← Назад
          </button>

          <button
            type="submit"
            className="btn-primary !text-xs"
            disabled={submitting || (step === 1 && !canLeaveStep1)}
            title={
              step === 1 && !canLeaveStep1 ? 'Заполните название проекта и заказчика' : undefined
            }
          >
            {submitting ? 'Создание расчёта…' : step === 3 ? 'Создать расчёт' : 'Далее →'}
          </button>
        </div>
      </form>

      {/* ---------- Живая сводка ---------- */}
      <div className="space-y-3 lg:sticky lg:top-[calc(var(--app-header-h)+1rem)] lg:self-start">
        <div className="card-flat space-y-3 p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
            Оценка обновляется по ответам
          </span>

          <div className="flex items-baseline gap-1.5">
            <span
              className={`nums text-3xl font-extrabold text-brand-700 transition-opacity dark:text-nord-frost2 ${
                isEstimating ? 'opacity-50' : ''
              }`}
            >
              {estimate?.totalHours ?? 0}
            </span>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-nord-muted">
              чел·часов
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['Этапов', estimate?.stageCount ?? 0],
                ['Календарных дней', estimate?.calendarDays ?? 0],
                ['Ролей', estimate?.roleCount ?? 0],
                [
                  'Смета КП',
                  estimate ? formatMoney(estimate.priceTotal, estimate.currencySymbol) : '—',
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-nord-1">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-nord-muted">
                  {label}
                </div>
                <div className="nums mt-0.5 text-sm font-extrabold text-slate-900 dark:text-nord-6">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card-flat space-y-1.5 p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
            Что дальше
          </span>
          <p className="text-[11px] leading-relaxed text-slate-600 dark:text-nord-4">
            После создания расчёт откроется в рабочем пространстве: Гант, сценарии, смета КП и
            выпуск комплекта ГОСТ 34.
          </p>
        </div>
      </div>
    </div>
  );
}
