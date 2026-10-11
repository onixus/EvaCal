'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHANGE_REQUEST_ACTION_LABELS,
  CHANGE_REQUEST_STATUS_LABELS,
  type AffectedRequirement,
  type ChangeRequestStatus,
  type ProposedChangeItem,
} from '@/lib/changeRequests/types';
import {
  canEditChangeRequests,
  canDecideChangeRequests,
  canEstimateChangeRequests,
  formatChangeLabel,
  formatChangeRequestNumber,
} from '@/lib/changeRequests/workflow';
import type { ChangeRequestDto } from '@/lib/changeRequests/store';
import type { SerializedCalculation, SerializedGostPackage } from './types';

const STATUS_CLASSES: Record<ChangeRequestStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-nord-1 dark:text-nord-4',
  submitted: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  deferred: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
};

function StatusBadge({ status }: { status: ChangeRequestStatus }) {
  return (
    <span className={`rounded-sm px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASSES[status]}`}>
      {CHANGE_REQUEST_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function signed(value: number | string | null) {
  if (value === null) return '—';
  const n = Number(value);
  return n > 0 ? `+${value}` : String(value);
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('ru-RU') : '—';
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Ошибка ${res.status}`);
  return data as T;
}

const sectionTitle =
  'text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-nord-muted';
const labelCls = 'label text-xs font-bold text-slate-700 dark:text-nord-4';

interface FormState {
  title: string;
  initiator: string;
  reason: string;
  baseCalculationId: string;
  basePackageId: string;
  summary: string;
  selected: Record<string, { kind: 'none' | 'modify' | 'remove'; text: string }>;
  added: string;
  /** Версия черновика, которую правит автор (оптимистическая блокировка). */
  updatedAt?: string;
}

function emptyForm(baseCalculationId: string): FormState {
  return {
    title: '',
    initiator: '',
    reason: '',
    baseCalculationId,
    basePackageId: '',
    summary: '',
    selected: {},
    added: '',
  };
}

function formFromCr(cr: ChangeRequestDto): FormState {
  const selected: FormState['selected'] = {};
  for (const r of cr.affectedRequirements) selected[r.id] = { kind: 'none', text: '' };
  for (const item of cr.proposedChanges.items) {
    if (item.requirementId && item.kind !== 'add') {
      selected[item.requirementId] = { kind: item.kind, text: item.text };
    }
  }
  return {
    title: cr.title,
    initiator: cr.initiator,
    reason: cr.reason,
    baseCalculationId: cr.baseCalculationId,
    basePackageId: cr.basePackageId ?? '',
    summary: cr.proposedChanges.summary,
    selected,
    updatedAt: cr.updatedAt,
    added: cr.proposedChanges.items
      .filter((i) => i.kind === 'add')
      .map((i) => i.text)
      .join('\n'),
  };
}

function formToBody(form: FormState) {
  const items: ProposedChangeItem[] = [];
  for (const [requirementId, sel] of Object.entries(form.selected)) {
    if (sel.kind === 'modify' && sel.text.trim())
      items.push({ kind: 'modify', requirementId, text: sel.text.trim() });
    if (sel.kind === 'remove') items.push({ kind: 'remove', requirementId, text: sel.text.trim() });
  }
  for (const line of form.added.split('\n')) {
    if (line.trim()) items.push({ kind: 'add', requirementId: null, text: line.trim() });
  }
  return {
    title: form.title,
    initiator: form.initiator,
    reason: form.reason,
    baseCalculationId: form.baseCalculationId,
    basePackageId: form.basePackageId || null,
    requirementIds: Object.keys(form.selected),
    proposedChanges: { summary: form.summary, items },
  };
}

function ChangeRequestForm({
  projectId,
  calculations,
  packages,
  initial,
  editingId,
  onSaved,
  onCancel,
}: {
  projectId: string;
  calculations: SerializedCalculation[];
  packages: SerializedGostPackage[];
  initial: FormState;
  editingId: string | null;
  onSaved: (cr: ChangeRequestDto) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [requirements, setRequirements] = useState<AffectedRequirement[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const calcPackages = useMemo(
    // Базой может быть только выпущенный комплект: черновик мастер перезаписывает.
    () =>
      packages.filter((p) => p.calculationId === form.baseCalculationId && p.status !== 'draft'),
    [packages, form.baseCalculationId],
  );

  useEffect(() => {
    if (!form.basePackageId) {
      setRequirements([]);
      return;
    }
    let cancelled = false;
    setLoadingReqs(true);
    api<{ requirements: AffectedRequirement[] }>(
      `/api/projects/${projectId}/change-requests?packageId=${encodeURIComponent(form.basePackageId)}`,
    )
      .then((data) => !cancelled && setRequirements(data.requirements))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoadingReqs(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, form.basePackageId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggle = (id: string) =>
    setForm((f) => {
      const selected = { ...f.selected };
      if (selected[id]) delete selected[id];
      else selected[id] = { kind: 'none', text: '' };
      return { ...f, selected };
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = formToBody(form);
      const cr = editingId
        ? await api<ChangeRequestDto>(`/api/projects/${projectId}/change-requests/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...body, action: 'update', updatedAt: form.updatedAt }),
          })
        : await api<ChangeRequestDto>(`/api/projects/${projectId}/change-requests`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
      onSaved(cr);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h3 className="text-sm font-bold text-slate-900 dark:text-nord-6">
        {editingId ? 'Черновик запроса на изменение' : 'Новый запрос на изменение'}
      </h3>
      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Название</label>
          <input
            className="input text-sm"
            value={form.title}
            maxLength={200}
            onChange={(e) => set('title', e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelCls}>Инициатор</label>
          <input
            className="input text-sm"
            value={form.initiator}
            maxLength={200}
            placeholder="Кто запросил изменение"
            onChange={(e) => set('initiator', e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Причина</label>
        <textarea
          className="input text-sm"
          rows={2}
          value={form.reason}
          maxLength={4000}
          onChange={(e) => set('reason', e.target.value)}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Исходная версия расчёта</label>
          <select
            className="input text-sm"
            value={form.baseCalculationId}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                baseCalculationId: e.target.value,
                basePackageId: '',
                selected: {},
              }))
            }
            required
          >
            {calculations.map((c) => (
              <option key={c.id} value={c.id}>
                v{c.version} · {c.name} ({c.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Исходный комплект ГОСТ 34</label>
          <select
            className="input text-sm"
            value={form.basePackageId}
            onChange={(e) =>
              setForm((f) => ({ ...f, basePackageId: e.target.value, selected: {} }))
            }
          >
            <option value="">— без комплекта —</option>
            {calcPackages.map((p) => (
              <option key={p.id} value={p.id}>
                v{p.version} · {p.name} ({p.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {form.basePackageId && (
        <div className="space-y-2">
          <p className={sectionTitle}>Затронутые требования комплекта</p>
          {loadingReqs ? (
            <p className="text-xs text-slate-500">Загрузка требований…</p>
          ) : requirements.length === 0 ? (
            <p className="text-xs text-slate-500">В снимке комплекта нет требований.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {requirements.map((r) => {
                const sel = form.selected[r.id];
                return (
                  <li
                    key={r.id}
                    className="rounded-sm border border-slate-100 p-2 text-xs dark:border-nord-3"
                  >
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="checkbox" checked={!!sel} onChange={() => toggle(r.id)} />
                      <span>
                        <span className="font-mono font-bold">{r.code}</span> {r.text}
                      </span>
                    </label>
                    {sel && (
                      <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-[10rem_1fr]">
                        <select
                          className="input text-xs"
                          value={sel.kind}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              selected: {
                                ...f.selected,
                                [r.id]: { ...sel, kind: e.target.value as typeof sel.kind },
                              },
                            }))
                          }
                        >
                          <option value="none">Затронуто</option>
                          <option value="modify">Изменить</option>
                          <option value="remove">Исключить</option>
                        </select>
                        {sel.kind !== 'none' && (
                          <input
                            className="input text-xs"
                            placeholder={
                              sel.kind === 'modify' ? 'Новая редакция требования' : 'Пояснение'
                            }
                            value={sel.text}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                selected: {
                                  ...f.selected,
                                  [r.id]: { ...sel, text: e.target.value },
                                },
                              }))
                            }
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Суть изменения</label>
          <textarea
            className="input text-sm"
            rows={3}
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Новые требования (по одному в строке)</label>
          <textarea
            className="input text-sm"
            rows={3}
            value={form.added}
            onChange={(e) => set('added', e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary text-xs">
          {saving ? 'Сохранение…' : 'Сохранить черновик'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">
          Отмена
        </button>
      </div>
    </form>
  );
}

function EstimateForm({
  projectId,
  cr,
  onSaved,
}: {
  projectId: string;
  cr: ChangeRequestDto;
  onSaved: (cr: ChangeRequestDto) => void;
}) {
  // Поля пустые: специалист вводит значения сам, часы связанных этапов не подставляются.
  const [hours, setHours] = useState(cr.confirmedHours?.toString() ?? '');
  const [cost, setCost] = useState(cr.confirmedCost ?? '');
  const [days, setDays] = useState(cr.confirmedScheduleDays?.toString() ?? '');
  const [comment, setComment] = useState(cr.estimateComment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api<ChangeRequestDto>(
        `/api/projects/${projectId}/change-requests/${cr.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'estimate',
            hours: hours.trim() === '' ? null : Number(hours.replace(',', '.')),
            cost: cost.trim().replace(',', '.').replace(/\s/g, ''),
            scheduleDays: days.trim() === '' ? null : Number(days),
            comment,
          }),
        },
      );
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-sm border border-slate-100 p-3 dark:border-nord-3"
    >
      <p className={sectionTitle}>Оценка специалиста</p>
      <p className="text-[11px] text-slate-500 dark:text-nord-muted">
        Часы, стоимость и изменение срока вводятся явно. Часы связанных этапов показаны выше только
        для справки и не суммируются.
      </p>
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Доп. часы</label>
          <input
            className="input text-sm"
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelCls}>
            Стоимость ({cr.impact?.base.currency ?? 'RUB'}, без НДС)
          </label>
          <input
            className="input text-sm"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelCls}>Изменение срока, раб. дней</label>
          <input
            className="input text-sm"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            required
          />
        </div>
      </div>
      <textarea
        className="input text-sm"
        rows={2}
        placeholder="Обоснование оценки"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button type="submit" disabled={saving} className="btn-primary text-xs">
        {saving ? 'Сохранение…' : 'Подтвердить оценку'}
      </button>
    </form>
  );
}

const DECISION_LABELS = {
  accept: 'Принять',
  reject: 'Отклонить',
  defer: 'Отложить',
  reopen: 'Вернуть на оценку',
} as const;

function DecisionPanel({
  projectId,
  cr,
  onDone,
}: {
  projectId: string;
  cr: ChangeRequestDto;
  onDone: (cr: ChangeRequestDto) => void;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decisions: (keyof typeof DECISION_LABELS)[] =
    cr.status === 'deferred' ? ['reopen'] : ['accept', 'defer', 'reject'];
  const acceptBlocked = !cr.estimatedAt
    ? 'Нужна оценка специалиста'
    : cr.estimateMatchesBase === false
      ? 'База изменилась после оценки — переоцените'
      : null;

  const decide = async (action: keyof typeof DECISION_LABELS) => {
    if (
      action === 'accept' &&
      !window.confirm(
        `Принять ${formatChangeRequestNumber(cr.seq)} «${cr.title}»?\n\n` +
          `Будет создана новая версия расчёта со строкой ${formatChangeLabel(cr.seq)} ` +
          `(${cr.confirmedHours} ч, ${cr.confirmedCost} ${cr.impact?.base.currency ?? ''}, ` +
          `срок ${cr.confirmedScheduleDays} раб. дн.)` +
          (cr.basePackageId ? ' и черновая версия комплекта с правками требований' : '') +
          '. Решение необратимо; исходная база не изменится.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api<ChangeRequestDto>(`/api/projects/${projectId}/change-requests/${cr.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ action, comment }),
        }),
      );
      setComment('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-sm border border-slate-100 p-3 dark:border-nord-3">
      <p className={sectionTitle}>Решение</p>
      {cr.status === 'submitted' && (
        <p className="text-[11px] text-slate-500 dark:text-nord-muted">
          Принятие создаёт новую версию расчёта от исходной с отдельной строкой{' '}
          {formatChangeLabel(cr.seq)} на подтверждённые часы
          {cr.basePackageId ? ' и черновую версию комплекта с правками требований' : ''}. Исходная
          база не меняется.
        </p>
      )}
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
      <textarea
        className="input text-sm"
        rows={2}
        placeholder="Комментарий (для «Отклонить» и «Отложить» обязателен)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {decisions.map((d) => (
          <button
            key={d}
            type="button"
            disabled={busy || (d === 'accept' && !!acceptBlocked)}
            title={d === 'accept' && acceptBlocked ? acceptBlocked : undefined}
            className={
              d === 'accept' || d === 'reopen' ? 'btn-primary text-xs' : 'btn-secondary text-xs'
            }
            onClick={() => decide(d)}
          >
            {DECISION_LABELS[d]}
          </button>
        ))}
      </div>
      {acceptBlocked && cr.status === 'submitted' && (
        <p className="text-[11px] text-slate-500">Принять: {acceptBlocked.toLowerCase()}.</p>
      )}
    </div>
  );
}

function ChangeRequestDetail({
  projectId,
  cr,
  calculations,
  canEdit,
  canEstimateRole,
  canDecideRole,
  onChanged,
  onEdit,
  onDeleted,
}: {
  projectId: string;
  cr: ChangeRequestDto;
  calculations: SerializedCalculation[];
  canEdit: boolean;
  canEstimateRole: boolean;
  canDecideRole: boolean;
  onChanged: (cr: ChangeRequestDto) => void;
  onEdit: (cr: ChangeRequestDto) => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqById = new Map(cr.affectedRequirements.map((r) => [r.id, r]));
  const baseCalc = calculations.find((c) => c.id === cr.baseCalculationId);

  const removeDraft = async () => {
    if (!window.confirm(`Удалить черновик ${formatChangeRequestNumber(cr.seq)}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/change-requests/${cr.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await api<ChangeRequestDto>(`/api/projects/${projectId}/change-requests/${cr.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: 'submit' }),
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4 text-xs dark:border-nord-3">
      {error && <p className="font-medium text-rose-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className={sectionTitle}>Причина</p>
          <p className="whitespace-pre-wrap text-slate-700 dark:text-nord-4">{cr.reason}</p>
        </div>
        <div>
          <p className={sectionTitle}>Исходная база</p>
          <p className="text-slate-700 dark:text-nord-4">
            Расчёт {baseCalc ? `v${baseCalc.version} · ${baseCalc.name}` : '(удалён)'}
            {cr.impact?.base.packageVersion
              ? `; комплект v${cr.impact.base.packageVersion}`
              : '; без комплекта'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-nord-muted">
            До решения по запросу база не меняется.
          </p>
        </div>
      </div>

      <div>
        <p className={sectionTitle}>Затронутые требования и предлагаемые изменения</p>
        {cr.proposedChanges.summary && (
          <p className="mb-1 whitespace-pre-wrap text-slate-700 dark:text-nord-4">
            {cr.proposedChanges.summary}
          </p>
        )}
        <ul className="space-y-1">
          {cr.affectedRequirements.map((r) => {
            const change = cr.proposedChanges.items.find((i) => i.requirementId === r.id);
            return (
              <li key={r.id}>
                <span className="font-mono font-bold">{r.code}</span> {r.text}
                {change?.kind === 'modify' && (
                  <span className="block pl-4 text-emerald-700 dark:text-emerald-300">
                    → {change.text}
                  </span>
                )}
                {change?.kind === 'remove' && (
                  <span className="block pl-4 text-rose-700 dark:text-rose-300">
                    исключить{change.text ? `: ${change.text}` : ''}
                  </span>
                )}
              </li>
            );
          })}
          {cr.proposedChanges.items
            .filter((i) => i.kind === 'add')
            .map((i, idx) => (
              <li key={`add-${idx}`} className="text-emerald-700 dark:text-emerald-300">
                + новое: {i.text}
              </li>
            ))}
          {cr.affectedRequirements.length === 0 &&
            !cr.proposedChanges.items.some((i) => i.kind === 'add') && (
              <li className="text-slate-500">Не указаны.</li>
            )}
        </ul>
      </div>

      {cr.impact && (
        <div className="space-y-3">
          <div>
            <p className={sectionTitle}>Связанные работы (по трассировке комплекта)</p>
            {cr.impact.stages.length === 0 ? (
              <p className="text-slate-500">Связанных этапов нет.</p>
            ) : (
              <table className="mt-1 w-full text-left">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 font-semibold">Этап</th>
                    <th className="py-1 font-semibold">Роль</th>
                    <th className="py-1 font-semibold">Часы в базе (справочно)</th>
                    <th className="py-1 font-semibold">Требования</th>
                  </tr>
                </thead>
                <tbody>
                  {cr.impact.stages.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100 dark:border-nord-3">
                      <td className="py-1">{s.name}</td>
                      <td className="py-1">{s.role || '—'}</td>
                      <td className="py-1">{s.baseHours ?? '—'}</td>
                      <td className="py-1 font-mono">
                        {s.requirementIds
                          .map(
                            (id) =>
                              (reqById.get(id)?.code ?? id) +
                              (s.ruleRequirementIds?.includes(id) ? ' (по правилу)' : ''),
                          )
                          .join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {cr.impact.unlinkedRequirementIds.length > 0 && (
              <p className="mt-1 text-amber-700 dark:text-amber-300">
                Без связи с этапом:{' '}
                {cr.impact.unlinkedRequirementIds
                  .map((id) => reqById.get(id)?.code ?? id)
                  .join(', ')}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className={sectionTitle}>Документы к пересмотру</p>
              {cr.impact.documents.length === 0 ? (
                <p className="text-slate-500">—</p>
              ) : (
                <ul>
                  {cr.impact.documents.map((d) => (
                    <li key={d.type}>
                      <span className="font-mono font-bold uppercase">{d.type}</span> — {d.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className={sectionTitle}>Проверки (критерии приёмки требований)</p>
              {cr.impact.checks.length === 0 ? (
                <p className="text-slate-500">Критериев в комплекте нет.</p>
              ) : (
                <ul>
                  {cr.impact.checks.map((c, idx) => (
                    <li key={`${c.requirementId}-${idx}`}>
                      <span className="font-mono font-bold">{c.code}</span>: {c.criterion}
                    </li>
                  ))}
                </ul>
              )}
              {cr.acceptanceChecks && cr.acceptanceChecks.length > 0 && (
                <div className="mt-2">
                  <p className={sectionTitle}>Проверки приёмки комплекта</p>
                  <ul>
                    {cr.acceptanceChecks.map((c) => (
                      <li key={c.id}>
                        <span className="font-mono font-bold">{c.requirementCode}</span>: {c.title}
                      </li>
                    ))}
                  </ul>
                  {(cr.status === 'submitted' || cr.status === 'accepted') && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      В приёмке помечены «требует пересмотра».
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cr.estimatedAt && (
        <div className="rounded-sm bg-slate-50 p-3 dark:bg-nord-1/40">
          <p className={sectionTitle}>Подтверждённая оценка</p>
          <p className="text-slate-800 dark:text-nord-5">
            {signed(cr.confirmedHours)} ч · {signed(cr.confirmedCost)}{' '}
            {cr.impact?.base.currency ?? ''} · {signed(cr.confirmedScheduleDays)} раб. дн.
          </p>
          <p className="text-[11px] text-slate-500 dark:text-nord-muted">
            {cr.estimatedBy}, {fmtDate(cr.estimatedAt)}
            {cr.estimateComment ? ` — ${cr.estimateComment}` : ''}
          </p>
          {cr.estimateMatchesBase === false && (
            <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              База изменилась после оценки — перед принятием нужна переоценка.
            </p>
          )}
        </div>
      )}

      {cr.status === 'accepted' && cr.resultCalculationId && (
        <div className="rounded-sm bg-emerald-50 p-3 dark:bg-emerald-950/30">
          <p className={sectionTitle}>Результат принятия</p>
          <p className="text-slate-800 dark:text-nord-5">
            <a
              className="text-brand-700 hover:underline dark:text-nord-frost3"
              href={`/calculations/${cr.resultCalculationId}`}
            >
              Новая версия расчёта
            </a>{' '}
            с изменением {formatChangeLabel(cr.seq)}
            {cr.resultPackageId ? ' и черновая версия комплекта с правками требований' : ''}.
            Исходная база не изменена.
          </p>
        </div>
      )}

      {canDecideRole && (cr.status === 'submitted' || cr.status === 'deferred') && (
        <DecisionPanel projectId={projectId} cr={cr} onDone={onChanged} />
      )}

      {cr.status === 'submitted' && canEstimateRole && (
        <EstimateForm projectId={projectId} cr={cr} onSaved={onChanged} />
      )}

      {cr.status === 'draft' && canEdit && (
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => onEdit(cr)}>
            Редактировать
          </button>
          <button type="button" className="btn-primary text-xs" disabled={busy} onClick={submit}>
            Передать на оценку
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={busy}
            onClick={removeDraft}
          >
            Удалить черновик
          </button>
        </div>
      )}

      <div>
        <p className={sectionTitle}>История</p>
        <ul className="space-y-0.5">
          {(cr.events ?? []).map((e) => (
            <li key={e.id} className="text-slate-600 dark:text-nord-4">
              {fmtDate(e.at)} ·{' '}
              <strong>{CHANGE_REQUEST_ACTION_LABELS[e.action] ?? e.action}</strong> · {e.actor}
              {e.comment ? ` — ${e.comment}` : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ChangeRequestsTab({
  projectId,
  calculations,
  packages,
  wonCalculationId,
  sessionRole,
}: {
  projectId: string;
  calculations: SerializedCalculation[];
  packages: SerializedGostPackage[];
  wonCalculationId: string | null;
  sessionRole: string | null;
}) {
  const canEdit = canEditChangeRequests(sessionRole);
  const canEstimateRole = canEstimateChangeRequests(sessionRole);
  const canDecideRole = canDecideChangeRequests(sessionRole);
  const [items, setItems] = useState<ChangeRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Последний запрошенный id: ответ на ранее открытую карточку не перетирает текущую.
  const openRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<ChangeRequestDto | null>(null);
  const [form, setForm] = useState<{ initial: FormState; editingId: string | null } | null>(null);

  // Голова цепочки изменений: новый запрос оформляется только на ней.
  const [head, setHead] = useState<string | null>(null);
  const defaultBase = head ?? wonCalculationId ?? calculations[0]?.id ?? '';
  const baseOptions = head ? calculations.filter((c) => c.id === head) : calculations;

  const reload = useCallback(async () => {
    try {
      const data = await api<{
        changeRequests: ChangeRequestDto[];
        headCalculationId: string | null;
      }>(`/api/projects/${projectId}/change-requests`);
      setItems(data.changeRequests);
      setHead(data.headCalculationId ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = async (id: string) => {
    setError(null);
    if (openId === id) {
      openRef.current = null;
      setOpenId(null);
      setDetail(null);
      return;
    }
    openRef.current = id;
    setOpenId(id);
    setDetail(null);
    try {
      const loaded = await api<ChangeRequestDto>(
        `/api/projects/${projectId}/change-requests/${id}`,
      );
      if (openRef.current === id) setDetail(loaded);
    } catch (err) {
      if (openRef.current === id) setError((err as Error).message);
    }
  };

  const changed = (cr: ChangeRequestDto) => {
    setError(null);
    openRef.current = cr.id;
    setDetail(cr);
    setOpenId(cr.id);
    void reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
            Запросы на изменение требований
          </h2>
          <p className="text-xs text-slate-500 dark:text-nord-muted">
            Изменение фиксируется относительно согласованной версии расчёта и комплекта. До решения
            по запросу действующая база не меняется; часы, стоимость и срок подтверждает специалист.
          </p>
        </div>
        {canEdit && !form && calculations.length > 0 && (
          <button
            type="button"
            className="btn-primary shrink-0 text-xs"
            onClick={() => setForm({ initial: emptyForm(defaultBase), editingId: null })}
          >
            + Новый запрос
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {form && (
        <ChangeRequestForm
          key={form.editingId ?? 'new'}
          projectId={projectId}
          calculations={baseOptions}
          packages={packages}
          initial={form.initial}
          editingId={form.editingId}
          onCancel={() => setForm(null)}
          onSaved={(cr) => {
            setForm(null);
            changed(cr);
          }}
        />
      )}

      {items === null ? (
        <div className="card p-6 text-center text-xs text-slate-500">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center">
          <h3 className="font-semibold text-slate-800 dark:text-nord-5">Запросов пока нет</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-nord-muted">
            Создайте запрос, когда заказчик просит изменить согласованные требования.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((cr) => (
            <div key={cr.id} className="card space-y-3 p-5">
              <button
                type="button"
                className="flex w-full flex-col gap-1 text-left"
                onClick={() => open(cr.id)}
                aria-expanded={openId === cr.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-brand-700 dark:text-nord-frost3">
                    {formatChangeRequestNumber(cr.seq)}
                  </span>
                  <span className="text-sm font-bold text-slate-900 dark:text-nord-6">
                    {cr.title}
                  </span>
                  <StatusBadge status={cr.status} />
                </div>
                <span className="text-xs text-slate-500 dark:text-nord-muted">
                  Инициатор: {cr.initiator} · требований: {cr.affectedRequirements.length} ·
                  связанных этапов: {cr.impact?.stages.length ?? 0}
                  {cr.estimatedAt
                    ? ` · оценка: ${signed(cr.confirmedHours)} ч, ${signed(cr.confirmedCost)}, ${signed(cr.confirmedScheduleDays)} дн.`
                    : ' · оценки нет'}
                </span>
              </button>
              {openId === cr.id &&
                (detail?.id === cr.id ? (
                  <ChangeRequestDetail
                    projectId={projectId}
                    cr={detail}
                    calculations={calculations}
                    canEdit={canEdit}
                    canEstimateRole={canEstimateRole}
                    canDecideRole={canDecideRole}
                    onChanged={changed}
                    onEdit={(d) => setForm({ initial: formFromCr(d), editingId: d.id })}
                    onDeleted={() => {
                      openRef.current = null;
                      setOpenId(null);
                      setDetail(null);
                      void reload();
                    }}
                  />
                ) : (
                  <p className="text-xs text-slate-500">Загрузка…</p>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
