'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DeviationChart from '@/components/DeviationChart';
import StatCard from '@/components/StatCard';
import PageHeader from '@/components/PageHeader';
import { roleLabel } from '@/lib/roles';
import {
  GROUP_LABELS,
  METRIC_LABELS,
  type DeviationReportConfig,
  type DeviationReportResult,
  type GroupBy,
  type Metric,
  type TaskCatalogEntry,
} from '@/lib/deviations';
import type { SavedReport } from '@/lib/deviationsData';

interface Catalog {
  tasks: TaskCatalogEntry[];
  roles: string[];
  templates: string[];
  architects: string[];
  customers: string[];
  rows: number;
}

const EMPTY: DeviationReportConfig = {
  tasks: [],
  roles: [],
  templates: [],
  architects: [],
  customers: [],
  from: null,
  to: null,
  groupBy: 'task',
  metric: 'median',
  kind: 'hours',
  tolerance: 0.1,
  minSamples: 3,
};

function pct(v: number | null): string {
  return v === null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
}

export default function DeviationBuilder({
  catalog,
  saved,
  viewer,
}: {
  catalog: Catalog;
  saved: SavedReport[];
  viewer: { id: string; role: string };
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<DeviationReportConfig>(EMPTY);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<DeviationReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? catalog.tasks.filter((t) => t.label.toLowerCase().includes(q)) : catalog.tasks;
  }, [catalog.tasks, search]);

  const toggle = (list: string[] | undefined, v: string) =>
    (list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v];

  async function run(config = cfg) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/deviations/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка');
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!saveName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/deviations/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loadedId, name: saveName, config: cfg }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка');
      const data = await res.json();
      setLoadedId(data.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  function load(r: SavedReport) {
    setCfg({ ...EMPTY, ...r.config });
    setSaveName(r.name);
    // Чужой срез можно только сохранить как новый: обновление — автору или админу.
    setLoadedId(r.createdBy === viewer.id || viewer.role === 'admin' ? r.id : null);
    void run({ ...EMPTY, ...r.config });
  }

  async function remove(r: SavedReport) {
    if (!confirm(`Удалить срез «${r.name}»?`)) return;
    await fetch(`/api/deviations/reports?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    if (loadedId === r.id) setLoadedId(null);
    router.refresh();
  }

  const Chip = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`filter-chip ${active ? 'filter-chip-active' : ''}`}
    >
      {children}
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Конструктор срезов по отклонениям"
        description={`Выберите задачи, фильтры и группировку. Отклонение — факт / план − 1 по этапу выигранной версии; наблюдений всего: ${catalog.rows}.`}
        actions={
          <Link href="/analytics?tab=deviations" className="btn-ghost">
            К аналитике
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <div className="card p-4 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="card-title">Задачи</h2>
              <span className="text-slate-400">
                {cfg.tasks.length ? `выбрано ${cfg.tasks.length}` : 'все'}
              </span>
            </div>
            <input
              className="input mb-2 text-xs"
              placeholder="Поиск задачи…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {tasks.map((t) => (
                <label key={t.key} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={cfg.tasks.includes(t.key)}
                    onChange={() => setCfg({ ...cfg, tasks: toggle(cfg.tasks, t.key) })}
                  />
                  <span className="flex-1">
                    {t.label}
                    <span className="ml-1 text-slate-400">
                      n={t.samples}, {pct(t.medianDeviation)}
                    </span>
                  </span>
                </label>
              ))}
              {tasks.length === 0 && <p className="text-slate-400">Ничего не найдено.</p>}
            </div>
            {cfg.tasks.length > 0 && (
              <button
                className="mt-2 text-slate-500 underline"
                onClick={() => setCfg({ ...cfg, tasks: [] })}
              >
                снять выбор
              </button>
            )}
          </div>

          <div className="card space-y-3 p-4 text-xs">
            <h2 className="card-title">Фильтры</h2>
            {(
              [
                ['roles', 'Роли', catalog.roles, (v: string) => roleLabel(v)],
                ['templates', 'Шаблоны', catalog.templates, (v: string) => v],
                ['architects', 'Архитекторы', catalog.architects, (v: string) => v],
                ['customers', 'Заказчики', catalog.customers, (v: string) => v],
              ] as const
            ).map(([key, label, values, fmt]) =>
              values.length === 0 ? null : (
                <div key={key}>
                  <div className="label text-[10px]">{label}</div>
                  <div className="flex flex-wrap gap-1">
                    {values.map((v) => (
                      <Chip
                        key={v}
                        active={(cfg[key] ?? []).includes(v)}
                        onClick={() => setCfg({ ...cfg, [key]: toggle(cfg[key], v) })}
                      >
                        {fmt(v)}
                      </Chip>
                    ))}
                  </div>
                </div>
              ),
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="label text-[10px]">Исход с</div>
                <input
                  type="date"
                  className="input text-xs"
                  value={cfg.from ?? ''}
                  onChange={(e) => setCfg({ ...cfg, from: e.target.value || null })}
                />
              </div>
              <div>
                <div className="label text-[10px]">по</div>
                <input
                  type="date"
                  className="input text-xs"
                  value={cfg.to ?? ''}
                  onChange={(e) => setCfg({ ...cfg, to: e.target.value || null })}
                />
              </div>
            </div>
          </div>

          <div className="card space-y-3 p-4 text-xs">
            <h2 className="card-title">Срез</h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="label text-[10px]">Группировать по</div>
                <select
                  className="input text-xs"
                  value={cfg.groupBy}
                  onChange={(e) => setCfg({ ...cfg, groupBy: e.target.value as GroupBy })}
                >
                  {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
                    <option key={g} value={g}>
                      {GROUP_LABELS[g]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="label text-[10px]">Метрика</div>
                <select
                  className="input text-xs"
                  value={cfg.metric}
                  onChange={(e) => setCfg({ ...cfg, metric: e.target.value as Metric })}
                >
                  {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
                    <option key={m} value={m}>
                      {METRIC_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="label text-[10px]">Сравнивать</div>
                <select
                  className="input text-xs"
                  value={cfg.kind ?? 'hours'}
                  onChange={(e) =>
                    setCfg({ ...cfg, kind: e.target.value === 'days' ? 'days' : 'hours' })
                  }
                >
                  <option value="hours">часы</option>
                  <option value="days">календарные дни</option>
                </select>
              </div>
              <div>
                <div className="label text-[10px]">Допуск, %</div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input text-xs"
                  value={Math.round((cfg.tolerance ?? 0.1) * 100)}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      tolerance: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100,
                    })
                  }
                />
              </div>
              <div>
                <div className="label text-[10px]">Мин. наблюдений</div>
                <input
                  type="number"
                  min={1}
                  className="input text-xs"
                  value={cfg.minSamples ?? 3}
                  onChange={(e) =>
                    setCfg({ ...cfg, minSamples: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={busy}
                onClick={() => run()}
              >
                {busy ? 'Считаю…' : 'Построить срез'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setCfg(EMPTY);
                  setResult(null);
                  setLoadedId(null);
                  setSaveName('');
                }}
              >
                Сброс
              </button>
            </div>
          </div>

          <div className="card space-y-2 p-4 text-xs">
            <h2 className="card-title">Сохранённые срезы</h2>
            <div className="flex gap-2">
              <input
                className="input text-xs"
                placeholder="Название среза"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !saveName.trim()}
                onClick={save}
              >
                {loadedId ? 'Обновить' : 'Сохранить'}
              </button>
            </div>
            {saved.length === 0 ? (
              <p className="text-slate-400">Пока ничего не сохранено.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-nord-3">
                {saved.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                    <button
                      className={`text-left underline ${loadedId === r.id ? 'font-bold' : ''}`}
                      onClick={() => load(r)}
                    >
                      {r.name}
                    </button>
                    {(r.createdBy === viewer.id || viewer.role === 'admin') && (
                      <button
                        className="text-slate-400 hover:text-rose-600"
                        onClick={() => remove(r)}
                        title="Удалить"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="space-y-4">
          {error && (
            <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}
          {!result ? (
            <div className="card p-10 text-center text-sm text-slate-500 dark:text-nord-muted">
              Настройте срез слева и нажмите «Построить срез».
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatCard
                  title="Наблюдений"
                  value={String(result.overall.samples)}
                  hint={`из ${result.rowsTotal} строк`}
                />
                <StatCard
                  title={METRIC_LABELS[result.config.metric]}
                  value={pct(result.overall.value)}
                />
                <StatCard
                  title="Перерасход"
                  value={String(result.overall.over)}
                  hint={`> +${Math.round((result.config.tolerance ?? 0.1) * 100)}%`}
                />
                <StatCard title="В допуске" value={String(result.overall.within)} />
                <StatCard title="Недорасход" value={String(result.overall.under)} />
              </div>

              <div className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="card-title">
                    {METRIC_LABELS[result.config.metric]} отклонения по:{' '}
                    {GROUP_LABELS[result.config.groupBy].toLowerCase()}
                  </h2>
                  <form method="post" action="/api/deviations/report/xlsx">
                    <input type="hidden" name="config" value={JSON.stringify(result.config)} />
                    <button type="submit" className="btn-secondary">
                      Выгрузить xlsx
                    </button>
                  </form>
                </div>
                <DeviationChart
                  bars={result.groups.map((g) => ({
                    key: g.key,
                    label: g.label,
                    value: g.value,
                    samples: g.samples,
                    lowSample: g.lowSample,
                    detail: `${g.label}: медиана ${pct(g.median)}, среднее ${pct(g.mean)}, P90 ${pct(g.p90)}, план ${g.plannedTotal} / факт ${g.actualTotal}`,
                  }))}
                  tolerance={result.config.tolerance ?? 0.1}
                  maxBars={30}
                />
              </div>

              <div className="card overflow-x-auto p-0">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
                    <tr>
                      <th className="px-4 py-2">{GROUP_LABELS[result.config.groupBy]}</th>
                      <th className="px-2 py-2 text-right">n</th>
                      <th className="px-2 py-2 text-right">Медиана</th>
                      <th className="px-2 py-2 text-right">Среднее</th>
                      <th className="px-2 py-2 text-right">P90</th>
                      <th className="px-2 py-2 text-right">Мин…Макс</th>
                      <th className="px-2 py-2 text-right">↑ / = / ↓</th>
                      <th className="px-2 py-2 text-right">План</th>
                      <th className="px-4 py-2 text-right">Факт</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
                    {result.groups.map((g) => (
                      <tr key={g.key}>
                        <td className="px-4 py-1.5 font-medium">
                          {g.label}
                          {g.lowSample ? ' *' : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{g.samples}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{pct(g.median)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{pct(g.mean)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{pct(g.p90)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {pct(g.min)}…{pct(g.max)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {g.over} / {g.within} / {g.under}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{g.plannedTotal}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{g.actualTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.groups.length === 0 && (
                  <p className="px-4 py-6 text-center text-xs text-slate-500">
                    Под фильтры ничего не попало.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
