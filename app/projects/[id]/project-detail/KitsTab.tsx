'use client';

/**
 * Наборы решений проекта (#103 WP-7b): применение утверждённой версии набора
 * к последнему расчёту с адаптацией (выбор элементов, правки, драйверы),
 * предложения обновлений (дифф по elementId, перенос выбранного в новую
 * версию расчёта) и журнал применений. Правила считает сервер.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SerializedCalculation } from './types';
import type { ApplicationPlan, ElementOverride, KitSelection } from '@/lib/kitApplication/plan';
import type { KitUpdateProposal } from '@/lib/kitApplication/update';
import {
  KIT_SECTION_LABELS,
  type KitSection,
  type SolutionKitContent,
} from '@/lib/solutionKits/content';

interface KitListItem {
  id: string;
  key: string;
  name: string;
  status: string;
  currentVersion: number | null;
}

interface ApplicationRow {
  id: string;
  kind: 'apply' | 'update';
  appliedBy: string;
  appliedAt: string;
  packageId: string | null;
  kitVersion: { version: number; kit: { key: string; name: string } };
  fromVersion: { version: number } | null;
}

type Proposal = KitUpdateProposal & { kitName: string };

const SECTIONS: Exclude<KitSection, 'fields'>[] = [
  'stages',
  'risks',
  'requirements',
  'checks',
  'fragments',
];

const SKIP_LABELS: Record<string, string> = {
  excluded: 'исключён',
  'already-applied': 'уже в проекте',
  'no-target': 'нет цели',
  'requirement-not-selected': 'нет требований',
  'id-conflict': 'конфликт id',
};

const KIND_LABELS = { added: 'добавлен', removed: 'удалён', changed: 'изменён' } as const;

const fmt = (s: string) => new Date(s).toLocaleString('ru-RU');

function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function elementLabel(section: KitSection, e: Record<string, unknown>): string {
  switch (section) {
    case 'stages':
      return `${e.name} (${e.role})`;
    case 'risks':
      return String(e.description);
    case 'requirements':
      return `${e.code ? `${e.code} · ` : ''}${e.title}`;
    case 'checks':
      return String(e.criteria);
    case 'fragments':
      return `${e.sectionKey}: ${e.title ?? String(e.text).slice(0, 60)}`;
    default:
      return String(e.elementId);
  }
}

/** Какое поле правится в адаптации для раздела. */
const EDIT_FIELD: Partial<Record<KitSection, { key: keyof ElementOverride; label: string }[]>> = {
  stages: [
    { key: 'name', label: 'Название' },
    { key: 'hours', label: 'Часы' },
  ],
  risks: [
    { key: 'description', label: 'Описание' },
    { key: 'hours', label: 'Часы' },
  ],
  requirements: [{ key: 'title', label: 'Заголовок' }],
  checks: [{ key: 'criteria', label: 'Критерий' }],
  fragments: [{ key: 'text', label: 'Текст' }],
};

export default function KitsTab({ calculation }: { calculation: SerializedCalculation | null }) {
  const router = useRouter();
  const [kits, setKits] = useState<KitListItem[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [kitId, setKitId] = useState('');
  const [content, setContent] = useState<SolutionKitContent | null>(null);
  const [plan, setPlan] = useState<ApplicationPlan | null>(null);
  const [selection, setSelection] = useState<KitSelection>({
    targets: { calculation: true, package: true },
    excluded: [],
    overrides: {},
    driverValues: {},
  });
  const [createVersion, setCreateVersion] = useState(false);
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const base = calculation ? `/api/calculations/${calculation.id}/kits` : null;

  const load = useCallback(async () => {
    if (!base) return;
    const [kitsRes, appRes] = await Promise.all([fetch('/api/solution-kits'), fetch(base)]);
    if (kitsRes.ok) {
      const list = ((await kitsRes.json()).kits as KitListItem[]).filter(
        (k) => k.status !== 'archived' && k.currentVersion,
      );
      setKits(list);
    }
    if (appRes.ok) {
      const data = await appRes.json();
      setApplications(data.applications);
      setProposals(data.proposals);
      setPicked(
        Object.fromEntries(
          (data.proposals as Proposal[]).map((p) => [
            p.kitId,
            new Set(p.changes.filter((c) => c.kitChanged).map((c) => c.elementId)),
          ]),
        ),
      );
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: data.error ?? `Ошибка ${res.status}` });
      return null;
    }
    return data;
  }

  async function preview(nextSelection = selection, id = kitId) {
    if (!base || !id) return;
    const data = await post(`${base}/preview`, { kitId: id, selection: nextSelection });
    if (data) {
      setPlan(data.plan);
      setContent(data.content);
    }
  }

  function chooseKit(id: string) {
    setKitId(id);
    setPlan(null);
    setContent(null);
    const fresh: KitSelection = {
      targets: { calculation: true, package: true },
      excluded: [],
      overrides: {},
      driverValues: {},
    };
    setSelection(fresh);
    if (id) void preview(fresh, id);
  }

  function toggleExcluded(elementId: string) {
    const excluded = selection.excluded.includes(elementId)
      ? selection.excluded.filter((x) => x !== elementId)
      : [...selection.excluded, elementId];
    setSelection({ ...selection, excluded });
  }

  function setOverride(elementId: string, key: keyof ElementOverride, raw: string) {
    const current = { ...(selection.overrides[elementId] ?? {}) } as Record<string, unknown>;
    if (raw === '') delete current[key];
    else current[key] = key === 'hours' ? Number(raw) : raw;
    const overrides = { ...selection.overrides };
    if (Object.keys(current).length === 0) delete overrides[elementId];
    else overrides[elementId] = current as ElementOverride;
    setSelection({ ...selection, overrides });
  }

  async function apply() {
    if (!base) return;
    const data = await post(`${base}/apply`, { kitId, selection, createVersion });
    if (data) {
      setMessage({
        ok: true,
        text:
          data.calculationId !== calculation?.id
            ? 'Набор применён к новой версии расчёта'
            : 'Набор применён к черновику',
      });
      setPlan(null);
      setKitId('');
      router.refresh();
      await load();
    }
  }

  async function applyUpdate(p: Proposal) {
    if (!base) return;
    const elementIds = [...(picked[p.kitId] ?? [])];
    const data = await post(`${base}/update`, {
      kitId: p.kitId,
      toVersion: p.toVersion,
      elementIds,
    });
    if (data) {
      setMessage({ ok: true, text: 'Создана новая версия расчёта с выбранными изменениями' });
      router.refresh();
      await load();
    }
  }

  function togglePicked(kit: string, elementId: string) {
    const set = new Set(picked[kit] ?? []);
    if (set.has(elementId)) set.delete(elementId);
    else set.add(elementId);
    setPicked({ ...picked, [kit]: set });
  }

  if (!calculation) {
    return <div className="card p-4 text-sm">В проекте нет расчёта.</div>;
  }

  const skipped = new Map((plan?.skipped ?? []).map((s) => [s.elementId, s.reason]));
  const numberFields = content?.fields.filter((f) => f.type === 'number') ?? [];

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`card p-3 text-xs ${message.ok ? 'text-emerald-700 dark:text-nord-green' : 'text-rose-700 dark:text-nord-red'}`}
        >
          {message.text}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Предложения обновлений</span>
          </div>
          <div className="space-y-4 p-4">
            {proposals.map((p) => (
              <div key={p.kitId} className="space-y-2">
                <div className="text-sm font-medium">
                  {p.kitName}: проект на v{p.projectVersions.join(', v')} → v{p.toVersion}
                </div>
                <table className="table-list text-xs">
                  <thead>
                    <tr>
                      <th />
                      <th>Элемент</th>
                      <th>Изменение</th>
                      <th>В проекте</th>
                      <th>В наборе v{p.toVersion}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.changes.map((c) => (
                      <tr key={c.elementId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={picked[p.kitId]?.has(c.elementId) ?? false}
                            onChange={() => togglePicked(p.kitId, c.elementId)}
                          />
                        </td>
                        <td>
                          <code>{c.elementId}</code> · {KIT_SECTION_LABELS[c.section]}
                        </td>
                        <td>
                          {KIND_LABELS[c.kind]}
                          {c.fields.length > 0 && `: ${c.fields.join(', ')}`}
                          {c.kind === 'changed' && !c.kitChanged && ' (правка проекта)'}
                        </td>
                        <td>
                          {c.project
                            ? (c.fields.length ? c.fields : Object.keys(c.project))
                                .map((f) => `${f}: ${short(c.project![f])}`)
                                .join('; ')
                            : '—'}
                        </td>
                        <td>
                          {c.kit
                            ? (c.fields.length ? c.fields : Object.keys(c.kit))
                                .map((f) => `${f}: ${short(c.kit![f])}`)
                                .join('; ')
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn-primary"
                  disabled={busy || !(picked[p.kitId]?.size ?? 0)}
                  onClick={() => applyUpdate(p)}
                >
                  Новая версия расчёта с выбранными изменениями
                </button>
                <p className="text-xs text-slate-500 dark:text-nord-muted">
                  Текущая версия расчёта и выпущенные комплекты не меняются: изменения переносятся в
                  новую черновую версию.
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">
            Применить набор к расчёту v{calculation.version}
            {calculation.status !== 'draft' && ' (не черновик)'}
          </span>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="label">Набор (утверждённая версия)</span>
              <select className="input" value={kitId} onChange={(e) => chooseKit(e.target.value)}>
                <option value="">— выберите —</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} · v{k.currentVersion}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selection.targets.calculation}
                onChange={(e) =>
                  setSelection({
                    ...selection,
                    targets: { ...selection.targets, calculation: e.target.checked },
                  })
                }
              />
              Этапы и риски расчёта
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selection.targets.package}
                onChange={(e) =>
                  setSelection({
                    ...selection,
                    targets: { ...selection.targets, package: e.target.checked },
                  })
                }
              />
              Черновик комплекта ГОСТ 34
            </label>
            {calculation.status !== 'draft' && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={createVersion}
                  onChange={(e) => setCreateVersion(e.target.checked)}
                />
                Создать новую версию расчёта
              </label>
            )}
          </div>

          {content && numberFields.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {numberFields.map((f) => (
                <label key={f.key}>
                  <span className="label">{f.label}</span>
                  <input
                    className="input w-28"
                    type="number"
                    min={0}
                    placeholder={String(plan?.driverValues[f.key] ?? '')}
                    value={selection.driverValues[f.key] ?? ''}
                    onChange={(e) => {
                      const driverValues = { ...selection.driverValues };
                      if (e.target.value === '') delete driverValues[f.key];
                      else driverValues[f.key] = Number(e.target.value);
                      setSelection({ ...selection, driverValues });
                    }}
                  />
                </label>
              ))}
            </div>
          )}

          {content &&
            SECTIONS.map((section) =>
              content[section].length === 0 ? null : (
                <div key={section}>
                  <div className="font-medium">{KIT_SECTION_LABELS[section]}</div>
                  <ul className="space-y-1 pl-2 text-xs">
                    {(content[section] as unknown as Record<string, unknown>[]).map((e) => {
                      const id = String(e.elementId);
                      const reason = skipped.get(id);
                      const off = selection.excluded.includes(id);
                      return (
                        <li key={id} className="flex flex-wrap items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!off}
                            disabled={reason === 'already-applied'}
                            onChange={() => toggleExcluded(id)}
                          />
                          <code>{id}</code>
                          <span>{elementLabel(section, e)}</span>
                          {reason && reason !== 'excluded' && (
                            <span className="text-amber-700 dark:text-nord-yellow">
                              [{SKIP_LABELS[reason] ?? reason}]
                            </span>
                          )}
                          {!off &&
                            (EDIT_FIELD[section] ?? []).map((f) => (
                              <input
                                key={f.key}
                                className="input w-40 py-0.5 text-xs"
                                type={f.key === 'hours' ? 'number' : 'text'}
                                placeholder={f.label}
                                value={String(selection.overrides[id]?.[f.key] ?? '')}
                                onChange={(ev) => setOverride(id, f.key, ev.target.value)}
                              />
                            ))}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
            )}

          {plan && (
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              Будет создано: этапов {plan.stages.length}, рисков {plan.risks.length}, требований{' '}
              {plan.requirements.length}, проверок {plan.checks.length}, фрагментов{' '}
              {plan.fragments.length}, связей {plan.links.length}.
            </p>
          )}
          {kitId && (
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={busy} onClick={() => preview()}>
                Пересчитать план
              </button>
              <button
                className="btn-primary"
                disabled={busy || (calculation.status !== 'draft' && !createVersion)}
                onClick={apply}
              >
                Применить
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <span className="card-title">Журнал применений</span>
        </div>
        <table className="table-list text-xs">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Набор</th>
              <th>Действие</th>
              <th>Кто</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>{fmt(a.appliedAt)}</td>
                <td>
                  {a.kitVersion.kit.name} v{a.kitVersion.version}
                </td>
                <td>
                  {a.kind === 'apply'
                    ? 'применение'
                    : `обновление с v${a.fromVersion?.version ?? '?'}`}
                  {a.packageId ? ' · комплект' : ''}
                </td>
                <td>{a.appliedBy}</td>
              </tr>
            ))}
            {applications.length === 0 && (
              <tr>
                <td colSpan={4}>К этой версии расчёта наборы не применялись.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
