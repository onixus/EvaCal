'use client';

/**
 * Рабочее место набора решения (#103 WP-7a): версии, просмотр содержимого по
 * разделам, черновик (JSON + журнал изменений), проверка, дифф с предыдущей
 * версией, утверждение и архив. Права считает сервер; флаги лишь прячут кнопки.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  KIT_SECTIONS,
  KIT_SECTION_LABELS,
  type KitContentIssue,
  type KitElement,
  type KitScope,
  type KitSection,
  type SolutionKitContent,
} from '@/lib/solutionKits/content';
import type { KitVersionDiff } from '@/lib/solutionKits/diff';
import {
  KIT_STATUS_LABELS,
  KIT_VERSION_STATUS_LABELS,
  type KitStatus,
  type KitVersionStatus,
} from '@/lib/solutionKits/rules';

interface VersionMeta {
  id: string;
  version: number;
  status: KitVersionStatus;
  changelog: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  archivedBy: string | null;
  archivedAt: string | null;
}

interface Kit {
  id: string;
  key: string;
  name: string;
  ownerName: string | null;
  scope: KitScope;
  source: string;
  status: KitStatus;
  versions: VersionMeta[];
}

interface VersionFull extends VersionMeta {
  content: SolutionKitContent;
  stats: Record<KitSection, number>;
  issues: KitContentIssue[];
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU') : '—');

function elementSummary(section: KitSection, e: KitElement): string {
  const o = e as unknown as Record<string, unknown>;
  switch (section) {
    case 'fields':
      return `${o.label} (${o.key}, ${o.type})`;
    case 'requirements':
      return `${o.code ? `${o.code} · ` : ''}${o.title}`;
    case 'stages':
      return `${o.name} — ${o.role}, ${o.baseHours} ч + ${o.hoursPerUnit} ч × ${o.driver ?? '—'}`;
    case 'risks':
      return `${o.description} (${o.hours} ч)`;
    case 'checks':
      return `${o.criteria} → ${(o.requirementIds as string[]).join(', ')}${o.method ? ` [${o.method}]` : ''}`;
    case 'fragments':
      return `${o.sectionKey}: ${o.title ?? String(o.text).slice(0, 80)}`;
  }
}

function IssuesList({ issues, title }: { issues: KitContentIssue[]; title: string }) {
  if (issues.length === 0) return null;
  return (
    <div className="card p-3 text-xs text-rose-700 dark:text-nord-red">
      <div className="mb-1 font-medium">
        {title}: {issues.length}
      </div>
      <ul className="list-disc space-y-0.5 pl-5">
        {issues.slice(0, 50).map((i, n) => (
          <li key={n}>
            <code>{i.path}</code> — {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffView({ diff }: { diff: KitVersionDiff }) {
  return (
    <div className="space-y-2 text-xs">
      <div>
        {diff.from ? `v${diff.from.version}` : 'пусто'} → v{diff.to.version}: добавлено{' '}
        {diff.summary.added}, удалено {diff.summary.removed}, изменено {diff.summary.changed}, без
        изменений {diff.summary.unchanged}
        {diff.identical && ' — версии совпадают'}
      </div>
      {KIT_SECTIONS.map((s) => {
        const d = diff.sections[s];
        if (!d.added.length && !d.removed.length && !d.changed.length && !d.reordered) return null;
        return (
          <div key={s}>
            <div className="font-medium">
              {KIT_SECTION_LABELS[s]}
              {d.reordered && ' (изменён порядок)'}
            </div>
            <ul className="space-y-0.5 pl-4">
              {d.added.map((e) => (
                <li key={`a-${e.elementId}`} className="text-emerald-700 dark:text-nord-green">
                  + <code>{e.elementId}</code> {elementSummary(s, e)}
                </li>
              ))}
              {d.removed.map((e) => (
                <li key={`r-${e.elementId}`} className="text-rose-700 dark:text-nord-red">
                  − <code>{e.elementId}</code> {elementSummary(s, e)}
                </li>
              ))}
              {d.changed.map((c) => (
                <li key={`c-${c.elementId}`} className="text-amber-700 dark:text-nord-yellow">
                  ~ <code>{c.elementId}</code>: {c.fields.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function KitWorkspace({
  kit,
  canEdit,
  canGovern,
}: {
  kit: Kit;
  canEdit: boolean;
  canGovern: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(kit.versions[0]?.version ?? null);
  const [version, setVersion] = useState<VersionFull | null>(null);
  const [draftJson, setDraftJson] = useState('');
  const [changelog, setChangelog] = useState('');
  const [issues, setIssues] = useState<KitContentIssue[]>([]);
  const [shapeIssues, setShapeIssues] = useState<KitContentIssue[]>([]);
  const [diff, setDiff] = useState<KitVersionDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const base = `/api/solution-kits/${kit.id}`;

  const load = useCallback(
    async (v: number) => {
      const res = await fetch(`${base}/versions/${v}`);
      if (!res.ok) return;
      const data = (await res.json()).version as VersionFull;
      setVersion(data);
      setDraftJson(JSON.stringify(data.content, null, 2));
      setChangelog(data.changelog);
      setIssues(data.issues);
      setShapeIssues([]);
      setDiff(null);
    },
    [base],
  );

  useEffect(() => {
    if (selected !== null) void load(selected);
  }, [selected, load]);

  async function call(
    url: string,
    init: RequestInit,
    okText: string,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: data.error ?? `Ошибка ${res.status}` });
      if (Array.isArray(data.issues)) {
        setShapeIssues(data.issues.filter((i: KitContentIssue) => i.code === 'shape'));
        setIssues(data.issues.filter((i: KitContentIssue) => i.code !== 'shape'));
      }
      return null;
    }
    setMessage({ ok: true, text: okText });
    return data;
  }

  function parsedDraft(): unknown | undefined {
    try {
      return JSON.parse(draftJson);
    } catch (e) {
      setMessage({ ok: false, text: `JSON не разобран: ${(e as Error).message}` });
      return undefined;
    }
  }

  async function validate() {
    const content = parsedDraft();
    if (content === undefined) return;
    const data = await call(
      '/api/solution-kits/validate',
      { method: 'POST', body: JSON.stringify({ content }) },
      'Проверка выполнена',
    );
    if (data) {
      setShapeIssues(data.shapeIssues as KitContentIssue[]);
      setIssues(data.issues as KitContentIssue[]);
      setMessage({
        ok: Boolean(data.valid),
        text: data.valid ? 'Замечаний нет — версию можно утверждать' : 'Есть замечания',
      });
    }
  }

  async function save() {
    if (!version) return;
    const content = parsedDraft();
    if (content === undefined) return;
    const data = await call(
      `${base}/versions/${version.version}`,
      { method: 'PATCH', body: JSON.stringify({ content, changelog }) },
      'Черновик сохранён',
    );
    if (data) {
      setShapeIssues([]);
      setIssues(data.issues as KitContentIssue[]);
      await load(version.version);
    }
  }

  async function createDraft() {
    const data = await call(`${base}/versions`, { method: 'POST' }, 'Черновик создан');
    if (data) {
      router.refresh();
      setSelected((data.version as { version: number }).version);
    }
  }

  async function action(path: string, okText: string, method = 'POST') {
    if (!version) return;
    const data = await call(`${base}/versions/${version.version}${path}`, { method }, okText);
    if (data) {
      router.refresh();
      if (method === 'DELETE') {
        setSelected(null);
        setVersion(null);
      } else await load(version.version);
    }
  }

  async function showDiff() {
    if (!version) return;
    const res = await fetch(`${base}/versions/${version.version}/diff`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setDiff(data.diff);
    else setMessage({ ok: false, text: data.error ?? 'Не удалось сравнить' });
  }

  async function setKitStatus(status: 'archived' | 'active') {
    const data = await call(
      base,
      { method: 'PATCH', body: JSON.stringify({ status }) },
      status === 'archived' ? 'Набор в архиве' : 'Набор возвращён из архива',
    );
    if (data) router.refresh();
  }

  const hasDraft = kit.versions.some((v) => v.status === 'draft');
  const isDraft = version?.status === 'draft';

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <div className="label">Статус</div>
            {KIT_STATUS_LABELS[kit.status]}
          </div>
          <div>
            <div className="label">Владелец</div>
            {kit.ownerName ?? 'системный (утверждает администратор)'}
          </div>
          <div>
            <div className="label">Отрасли</div>
            {kit.scope.industries.join('; ') || '—'}
          </div>
          <div>
            <div className="label">Типы продуктов</div>
            {kit.scope.productTypes.join('; ') || '—'}
          </div>
        </div>
        {kit.scope.notes && (
          <p className="mt-2 text-xs text-slate-500 dark:text-nord-muted">{kit.scope.notes}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {canEdit && !hasDraft && kit.status !== 'archived' && (
            <button className="btn-secondary" disabled={busy} onClick={createDraft}>
              Новая версия (копия последней)
            </button>
          )}
          {canGovern && kit.status !== 'archived' && (
            <button
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setKitStatus('archived')}
            >
              Архивировать набор
            </button>
          )}
          {canGovern && kit.status === 'archived' && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => setKitStatus('active')}
            >
              Вернуть из архива
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`card p-3 text-xs ${message.ok ? 'text-emerald-700 dark:text-nord-green' : 'text-rose-700 dark:text-nord-red'}`}
        >
          {message.text}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="card-head">
          <span className="card-title">Версии</span>
        </div>
        <table className="table-list">
          <thead>
            <tr>
              <th>Версия</th>
              <th>Статус</th>
              <th>Изменения</th>
              <th>Создал</th>
              <th>Утвердил</th>
            </tr>
          </thead>
          <tbody>
            {kit.versions.map((v) => (
              <tr
                key={v.id}
                className={`cursor-pointer ${selected === v.version ? 'font-semibold' : ''}`}
                onClick={() => setSelected(v.version)}
              >
                <td className="nums">v{v.version}</td>
                <td className="text-xs">{KIT_VERSION_STATUS_LABELS[v.status]}</td>
                <td className="text-xs">{v.changelog || '—'}</td>
                <td className="text-xs">
                  {v.createdBy}, {fmt(v.createdAt)}
                </td>
                <td className="text-xs">
                  {v.approvedBy ? `${v.approvedBy}, ${fmt(v.approvedAt)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {version && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">
              Версия {version.version} — {KIT_VERSION_STATUS_LABELS[version.status]}
            </span>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2 text-xs">
              {KIT_SECTIONS.map((s) => (
                <span key={s}>
                  {KIT_SECTION_LABELS[s]}: <b>{version.stats[s]}</b>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={busy} onClick={showDiff}>
                Сравнить с предыдущей
              </button>
              {isDraft && canEdit && (
                <>
                  <button className="btn-secondary" disabled={busy} onClick={validate}>
                    Проверить
                  </button>
                  <button className="btn-primary" disabled={busy} onClick={save}>
                    Сохранить черновик
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => action('', 'Черновик удалён', 'DELETE')}
                  >
                    Удалить черновик
                  </button>
                </>
              )}
              {isDraft && canGovern && (
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => action('/approve', 'Версия утверждена')}
                >
                  Утвердить
                </button>
              )}
              {version.status === 'approved' && canGovern && (
                <button
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => action('/archive', 'Версия в архиве')}
                >
                  Архивировать версию
                </button>
              )}
            </div>

            <IssuesList issues={shapeIssues} title="Ошибки формы (сохранение невозможно)" />
            <IssuesList issues={issues} title="Замечания целостности (утверждение невозможно)" />
            {diff && <DiffView diff={diff} />}

            {isDraft && canEdit ? (
              <div className="space-y-2">
                <label className="block">
                  <span className="label">Журнал изменений версии</span>
                  <textarea
                    className="input min-h-16 text-xs"
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="label">
                    Содержимое (JSON: fields, requirements, stages, risks, checks, fragments)
                  </span>
                  <textarea
                    className="input min-h-96 font-mono text-xs"
                    value={draftJson}
                    onChange={(e) => setDraftJson(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </div>
            ) : (
              KIT_SECTIONS.map((s) =>
                version.content[s].length === 0 ? null : (
                  <details key={s} className="text-sm">
                    <summary className="cursor-pointer font-medium">
                      {KIT_SECTION_LABELS[s]} ({version.content[s].length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-4 text-xs">
                      {(version.content[s] as KitElement[]).map((e) => (
                        <li key={e.elementId}>
                          <code>{e.elementId}</code> {elementSummary(s, e)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ),
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
