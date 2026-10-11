'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { withShareHeaders } from '@/lib/shareClient';
import { detectImplementationSizingProfile } from '@/lib/presets/implementationSizing';
import { describeTotal } from '@/lib/specification/totals';
import type { SavedSpecification } from '@/lib/specification/types';
import type {
  SizingOutputValue,
  SizingProfileVersionView,
  SizingProfileView,
  SizingRunView,
} from '@/lib/sizing/types';
import { SIZING_METRIC_KINDS } from '@/lib/sizing/types';
import type { SizingImpactPreview } from '@/lib/sizing/impact';

interface SizingPanelProps {
  calculationId: string;
  answers: Record<string, unknown>;
}

const STATUS_LABELS = {
  ok: 'Покрыто',
  deficit: 'Дефицит',
  surplus: 'Избыток',
  unknown: 'Невозможно проверить',
  unlinked: 'Без связи с сайзингом',
} as const;
const STATUS_CLASS = {
  ok: 'text-emerald-700 dark:text-nord-14',
  deficit: 'text-red-700 dark:text-nord-11',
  surplus: 'text-amber-700 dark:text-nord-13',
  unknown: 'text-amber-700 dark:text-nord-13',
  unlinked: 'text-slate-500 dark:text-nord-muted',
} as const;

const fmt = (v: number | null) => (v === null ? 'неизвестно' : v.toLocaleString('ru-RU'));

function OutputsTable({
  outputs,
  link,
}: {
  outputs: SizingOutputValue[];
  link?: (metric: SizingOutputValue) => React.ReactNode;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-500">
          <th className="py-1">Метрика</th>
          <th>Значение</th>
          <th>Основание и допущения</th>
          {link ? <th /> : null}
        </tr>
      </thead>
      <tbody>
        {outputs.map((o) => (
          <tr key={o.key} className="border-t border-slate-100 align-top dark:border-nord-3">
            <td className="py-1">
              {o.label} <span className="text-xs text-slate-400">({o.key})</span>
            </td>
            <td className={o.value === null ? 'text-amber-700 dark:text-nord-13' : ''}>
              {fmt(o.value)} {o.value === null ? '' : o.unit}
              {o.value === null && o.missing.length ? (
                <div className="text-xs">не заданы: {o.missing.join(', ')}</div>
              ) : null}
            </td>
            <td className="text-xs text-slate-500">
              {o.basis}
              {o.assumptions.length ? <div>допущения: {o.assumptions.join(', ')}</div> : null}
            </td>
            {link ? <td>{link(o)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SizingPanel({ calculationId, answers }: SizingPanelProps) {
  const [profiles, setProfiles] = useState<SizingProfileView[]>([]);
  const [runs, setRuns] = useState<SizingRunView[]>([]);
  const [spec, setSpec] = useState<SavedSpecification | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [canEditProfiles, setCanEditProfiles] = useState(false);
  const [versionId, setVersionId] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SizingImpactPreview | null>(null);
  const [previewRunId, setPreviewRunId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, { on: boolean; force: boolean }>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [manual, setManual] = useState<{ rows: SizingOutputValue[]; note: string }>({
    rows: [],
    note: '',
  });
  const [linkForm, setLinkForm] = useState<{
    runId: string;
    scenario: string;
    metric: string;
    itemId: string;
    unitCapacity: string;
  } | null>(null);

  const call = useCallback(
    async (url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
      const res = await fetch(url, {
        method,
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
      return data;
    },
    [calculationId],
  );

  const versions = useMemo(
    () =>
      profiles.flatMap((p) =>
        p.versions.map((v) => ({ ...v, label: `${p.name} v${v.version}` })),
      ) as Array<SizingProfileVersionView & { label: string }>,
    [profiles],
  );
  const version = versions.find((v) => v.id === versionId);

  const load = useCallback(async () => {
    try {
      const [sizing, specification] = await Promise.all([
        call(`/api/calculations/${calculationId}/sizing`),
        call(`/api/calculations/${calculationId}/specification`).catch(() => null),
      ]);
      setProfiles(sizing.profiles);
      setRuns(sizing.runs);
      setCanWrite(sizing.canWrite);
      setCanEditProfiles(sizing.canEditProfiles);
      setSpec(specification?.specification ?? null);
      setVersionId((current) => {
        if (current) return current;
        // Профиль предлагается по ключам опросника, не по названию проекта.
        const detected = detectImplementationSizingProfile(answers);
        const list = (sizing.profiles as SizingProfileView[]).flatMap((p) =>
          p.versions.filter((v) => v.status === 'approved'),
        );
        return (list.find((v) => v.profileKey === detected) ?? list[0])?.id ?? '';
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [call, calculationId, answers]);

  useEffect(() => {
    load();
  }, [load]);

  // Входы профиля заполняются из ответов опросника; дальше редактируются отдельно.
  useEffect(() => {
    if (!version) return;
    const next: Record<string, string> = {};
    for (const def of version.rules.inputs) {
      const v = answers[def.key];
      next[def.key] = v === undefined || v === null ? '' : String(v);
    }
    setInputs(next);
    setRulesDraft(
      JSON.stringify(
        { rules: version.rules, assumptions: version.assumptions, source: version.source },
        null,
        2,
      ),
    );
  }, [version, answers]);

  const payloadInputs = () =>
    Object.fromEntries(Object.entries(inputs).filter(([, v]) => v.trim() !== ''));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const showPreview = (data: SizingImpactPreview, runId: string | null) => {
    setPreview(data);
    setPreviewRunId(runId);
    setSelected(
      Object.fromEntries(data.rows.map((r) => [r.itemId, { on: r.defaultSelected, force: false }])),
    );
  };

  const previewDraft = () =>
    run(async () =>
      showPreview(
        await call(`/api/calculations/${calculationId}/sizing/impact`, {
          profileVersionId: versionId,
          inputs: payloadInputs(),
        }),
        null,
      ),
    );
  const previewRun = (runId: string) =>
    run(async () =>
      showPreview(await call(`/api/calculations/${calculationId}/sizing/impact`, { runId }), runId),
    );
  const saveRun = () =>
    run(async () => {
      const created = await call(`/api/calculations/${calculationId}/sizing`, {
        profileVersionId: versionId,
        inputs: payloadInputs(),
      });
      await load();
      await previewRun(created.id);
    });
  const saveManual = () =>
    run(async () => {
      await call(`/api/calculations/${calculationId}/sizing`, {
        source: 'manual',
        note: manual.note,
        outputs: manual.rows,
      });
      setManual({ rows: [], note: '' });
      await load();
    });
  const applyPreview = () =>
    run(async () => {
      if (!preview || !previewRunId || !spec) return;
      const selections = Object.entries(selected)
        .filter(([, s]) => s.on)
        .map(([itemId, s]) => ({ itemId, ...(s.force ? { allowManualOverride: true } : {}) }));
      await call(`/api/calculations/${calculationId}/sizing/apply`, {
        runId: previewRunId,
        version: spec.snapshot.version,
        selections,
      });
      setPreview(null);
      await load();
    });
  const saveLink = () =>
    run(async () => {
      if (!linkForm || !spec) return;
      await call(`/api/calculations/${calculationId}/sizing/link`, {
        version: spec.snapshot.version,
        ...linkForm,
      });
      setLinkForm(null);
      await load();
    });
  const newProfileVersion = () =>
    run(async () => {
      if (!version) return;
      const body = JSON.parse(rulesDraft);
      const created = await call(`/api/sizing/profiles/${version.profileId}/versions`, body);
      await load();
      setVersionId(created.id);
    });
  const approve = () =>
    run(async () => {
      await call(`/api/sizing/versions/${versionId}`, {
        action: 'approve',
        expectedHash: version?.contentHash,
      });
      await load();
    });

  const items = spec?.snapshot.items ?? [];

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="font-semibold text-slate-900 dark:text-nord-6">
          Сайзинг: техническая потребность
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-nord-muted">
          Сайзинг считает ресурсы (узлы, поток, хранение, лицензионные единицы), а не закупаемые
          SKU. Параметры без ответа и без допущения профиля остаются неизвестными; результат
          закрепляет версию профиля. Влияние на спецификацию показывается до применения, а
          применение создает новую черновую редакцию.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700 dark:text-nord-11">
            {error}
          </p>
        ) : null}
        {spec ? (
          <p className="mt-2 text-xs text-slate-500">
            Спецификация: редакция {spec.snapshot.version}
            {spec.snapshot.sizingRunIds?.length
              ? `, связанные прогоны: ${spec.snapshot.sizingRunIds.length}`
              : ', связей с сайзингом нет'}
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-500">Спецификация еще не сохранена.</p>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <h3 className="font-semibold text-slate-900 dark:text-nord-6">Расчет по профилю</h3>
        <label className="block text-sm">
          Профиль и версия{' '}
          <select
            className="input mt-1"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.status === 'approved' ? 'утверждена' : 'черновик'}
              </option>
            ))}
          </select>
        </label>
        {version ? (
          <>
            <p className="text-xs text-slate-500">Источник: {version.source}</p>
            {version.assumptions.length ? (
              <ul className="list-disc pl-5 text-xs text-slate-500">
                {version.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-2 md:grid-cols-2">
              {version.rules.inputs.map((def) => (
                <label key={def.key} className="text-sm">
                  {def.label}
                  {def.unit ? `, ${def.unit}` : ''}
                  <input
                    className="input mt-1"
                    value={inputs[def.key] ?? ''}
                    placeholder={
                      def.default === undefined
                        ? 'не задано — метрика будет неизвестна'
                        : `допущение: ${String(def.default)}`
                    }
                    onChange={(e) => setInputs({ ...inputs, [def.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={busy} onClick={previewDraft}>
                Предпросмотр влияния (без сохранения)
              </button>
              {canWrite && version.status === 'approved' ? (
                <button className="btn-primary" disabled={busy} onClick={saveRun}>
                  Сохранить прогон
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">Нет доступных версий профилей.</p>
        )}
      </div>

      {preview ? (
        <div className="card space-y-3 p-5">
          <h3 className="font-semibold text-slate-900 dark:text-nord-6">
            Влияние на спецификацию: {preview.run.label}
          </h3>
          {(preview.run.outputs.base ?? []).length ? (
            <details open={preview.run.ephemeral}>
              <summary className="text-sm">Метрики (базовый сценарий)</summary>
              <OutputsTable outputs={preview.run.outputs.base ?? []} />
            </details>
          ) : null}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th />
                <th>Позиция</th>
                <th>Статус</th>
                <th>Потребность</th>
                <th>Количество</th>
                <th>Δ стоимости</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr
                  key={r.itemId}
                  className="border-t border-slate-100 align-top dark:border-nord-3"
                >
                  <td>
                    {r.status !== 'unknown' &&
                    r.status !== 'unlinked' &&
                    !r.bundle &&
                    !preview.run.ephemeral ? (
                      <input
                        type="checkbox"
                        aria-label={`Применить к ${r.name}`}
                        checked={selected[r.itemId]?.on ?? false}
                        onChange={(e) =>
                          setSelected({
                            ...selected,
                            [r.itemId]: {
                              on: e.target.checked,
                              force: selected[r.itemId]?.force ?? false,
                            },
                          })
                        }
                      />
                    ) : null}
                  </td>
                  <td>{r.name}</td>
                  <td className={STATUS_CLASS[r.status]}>
                    {STATUS_LABELS[r.status]}
                    <div className="text-xs">{r.reason}</div>
                    {r.manualQuantity && selected[r.itemId]?.on ? (
                      <label className="text-xs">
                        <input
                          type="checkbox"
                          checked={selected[r.itemId]?.force ?? false}
                          onChange={(e) =>
                            setSelected({
                              ...selected,
                              [r.itemId]: { on: true, force: e.target.checked },
                            })
                          }
                        />{' '}
                        заменить ручное количество
                      </label>
                    ) : null}
                  </td>
                  <td>
                    {r.metric
                      ? `${r.metricLabel}: ${r.linkedRequired ?? '?'} → ${r.newRequired ?? 'неизвестно'} ${r.metricUnit}`
                      : '—'}
                  </td>
                  <td>
                    {r.currentQuantity ?? '?'}
                    {r.proposedQuantity !== null ? ` → ${r.proposedQuantity}` : ''}
                  </td>
                  <td>{r.amountDelta === null ? '—' : `${r.amountDelta} ${r.currency}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.uncovered.length ? (
            <p className="text-xs text-slate-500">
              Метрики без покрывающих позиций:{' '}
              {preview.uncovered
                .map((u) => `${u.label} = ${fmt(u.value)} ${u.value === null ? '' : u.unit}`)
                .join('; ')}
            </p>
          ) : null}
          <div className="text-sm">
            <div>До: {preview.totals.before.map(describeTotal).join('; ') || '—'}</div>
            <div>После: {preview.totals.after.map(describeTotal).join('; ') || '—'}</div>
          </div>
          <ul className="list-disc pl-5 text-xs text-slate-500">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {canWrite && !preview.run.ephemeral && spec ? (
            <button className="btn-primary" disabled={busy} onClick={applyPreview}>
              Применить выбранное (новая черновая редакция)
            </button>
          ) : preview.run.ephemeral ? (
            <p className="text-xs text-slate-500">
              Это предпросмотр без сохранения. Чтобы применить, сохраните прогон по утвержденной
              версии.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card space-y-3 p-5">
        <h3 className="font-semibold text-slate-900 dark:text-nord-6">Прогоны расчета</h3>
        {runs.length === 0 ? <p className="text-sm text-slate-500">Прогонов нет.</p> : null}
        {runs.map((r) => (
          <details key={r.id} className="rounded border border-slate-200 p-3 dark:border-nord-3">
            <summary className="text-sm">
              {r.profile ? `${r.profile.name} v${r.profile.version}` : 'Ручной сайзинг'} ·{' '}
              {new Date(r.createdAt).toLocaleString('ru-RU')}
              {spec?.snapshot.sizingRunIds?.includes(r.id) ? ' · связан со спецификацией' : ''}
            </summary>
            {r.note ? <p className="text-xs text-slate-500">{r.note}</p> : null}
            {r.results.map((s) => (
              <div key={s.key} className="mt-2">
                <h4 className="text-sm font-medium">Сценарий: {s.label}</h4>
                {s.warnings.length ? (
                  <ul className="text-xs text-amber-700 dark:text-nord-13">
                    {s.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                <OutputsTable
                  outputs={s.outputs}
                  link={
                    canWrite && spec && items.length
                      ? (o) =>
                          o.value === null ? null : (
                            <button
                              className="text-xs text-brand-600 hover:underline dark:text-nord-frost2"
                              onClick={() =>
                                setLinkForm({
                                  runId: r.id,
                                  scenario: s.key,
                                  metric: o.key,
                                  itemId: items[0].id,
                                  unitCapacity: '1',
                                })
                              }
                            >
                              Связать с позицией
                            </button>
                          )
                      : undefined
                  }
                />
              </div>
            ))}
            <button
              className="btn-secondary mt-2"
              disabled={busy || !spec}
              onClick={() => previewRun(r.id)}
            >
              Влияние на спецификацию
            </button>
          </details>
        ))}
        {linkForm ? (
          <div className="space-y-2 rounded border border-slate-200 p-3 text-sm dark:border-nord-3">
            <div>
              Связь метрики <b>{linkForm.metric}</b> (сценарий {linkForm.scenario}) с позицией
            </div>
            <select
              className="input"
              value={linkForm.itemId}
              onChange={(e) => setLinkForm({ ...linkForm, itemId: e.target.value })}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name || i.id} ({i.quantity ?? '?'} {i.unit})
                </option>
              ))}
            </select>
            <label className="block">
              Сколько единиц метрики покрывает одна единица позиции
              <input
                className="input mt-1"
                value={linkForm.unitCapacity}
                onChange={(e) => setLinkForm({ ...linkForm, unitCapacity: e.target.value })}
              />
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy} onClick={saveLink}>
                Связать (новая черновая редакция)
              </button>
              <button className="btn-secondary" onClick={() => setLinkForm(null)}>
                Отмена
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {canWrite ? (
        <div className="card space-y-3 p-5">
          <h3 className="font-semibold text-slate-900 dark:text-nord-6">Ручной сайзинг</h3>
          <p className="text-xs text-slate-500">
            Метрики вводятся вручную и сохраняются прогоном с источником «ручная оценка». Пустое
            значение означает «неизвестно», не 0.
          </p>
          {manual.rows.map((row, index) => {
            const update = (patch: Partial<SizingOutputValue>) =>
              setManual({
                ...manual,
                rows: manual.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
              });
            return (
              <div key={index} className="grid gap-2 md:grid-cols-5">
                <input
                  className="input"
                  placeholder="ключ (nodes)"
                  value={row.key}
                  onChange={(e) => update({ key: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="название"
                  value={row.label}
                  onChange={(e) => update({ label: e.target.value })}
                />
                <select
                  className="input"
                  value={row.kind}
                  onChange={(e) => update({ kind: e.target.value as SizingOutputValue['kind'] })}
                >
                  {SIZING_METRIC_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder="единица"
                  value={row.unit}
                  onChange={(e) => update({ unit: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="значение"
                  value={row.value ?? ''}
                  onChange={(e) =>
                    update({ value: e.target.value.trim() === '' ? null : Number(e.target.value) })
                  }
                />
              </div>
            );
          })}
          <button
            className="btn-secondary"
            onClick={() =>
              setManual({
                ...manual,
                rows: [
                  ...manual.rows,
                  {
                    key: '',
                    label: '',
                    kind: 'nodes',
                    unit: 'шт.',
                    value: null,
                    missing: [],
                    assumptions: [],
                    basis: 'ручная оценка',
                  },
                ],
              })
            }
          >
            Добавить метрику
          </button>
          <label className="block text-sm">
            Основание ручной оценки
            <input
              className="input mt-1"
              value={manual.note}
              onChange={(e) => setManual({ ...manual, note: e.target.value })}
            />
          </label>
          <button
            className="btn-primary"
            disabled={busy || !manual.rows.length || !manual.note.trim()}
            onClick={saveManual}
          >
            Сохранить ручной сайзинг
          </button>
        </div>
      ) : null}

      {canEditProfiles && version ? (
        <div className="card space-y-3 p-5">
          <h3 className="font-semibold text-slate-900 dark:text-nord-6">
            Профиль {version.profileName}: новая версия
          </h3>
          <p className="text-xs text-slate-500">
            Утвержденная версия неизменяема. Правки сохраняются новой черновой версией; старые
            прогоны остаются на своей версии. Формулы — безопасный язык: + − × ÷, сравнения, ?:,
            max/min/ceil/floor/round/if/lookup.
          </p>
          <textarea
            className="input h-64 font-mono text-xs"
            value={rulesDraft}
            onChange={(e) => setRulesDraft(e.target.value)}
            aria-label="Правила профиля (JSON)"
          />
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={busy} onClick={newProfileVersion}>
              Сохранить как новую черновую версию
            </button>
            {version.status === 'draft' ? (
              <button className="btn-primary" disabled={busy} onClick={approve}>
                Утвердить версию v{version.version}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
