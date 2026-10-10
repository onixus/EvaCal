'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ACCEPTANCE_STATUS_LABELS,
  REMARK_STATUS_LABELS,
  VERIFICATION_METHOD_LABELS,
  type AcceptanceStatus,
  type EvidenceRef,
} from '@/lib/acceptance/rules';
import type { ChecksResponse, SerializedCheck, SerializedRemark } from '@/lib/acceptance/types';
import type { SerializedGostPackage } from './types';

const STATUS_STYLES: Record<AcceptanceStatus, string> = {
  not_run: 'bg-slate-100 text-slate-700 dark:bg-nord-1 dark:text-nord-4',
  passed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  blocked: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
};

function StatusBadge({ status }: { status: AcceptanceStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLES[status]}`}>
      {ACCEPTANCE_STATUS_LABELS[status]}
    </span>
  );
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error || `Ошибка ${res.status}`;
}

/** Локальное время для `datetime-local` (без секунд). */
function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function ResultForm({
  pkgId,
  check,
  onSaved,
}: {
  pkgId: string;
  check: SerializedCheck;
  onSaved: () => void;
}) {
  // Состояние не выбрано заранее: «пройдена» по умолчанию не назначается
  // даже в форме — испытатель выбирает его явно.
  const [status, setStatus] = useState<AcceptanceStatus | ''>('');
  const [executorSelf, setExecutorSelf] = useState(true);
  const [executorName, setExecutorName] = useState('');
  const [executedAt, setExecutedAt] = useState(nowLocalInput);
  const [actualResult, setActualResult] = useState('');
  const [remark, setRemark] = useState('');
  const [evidence, setEvidence] = useState<EvidenceRef[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const base = `/api/gost34/packages/${pkgId}/checks/${check.id}`;

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setErrors([]);
    setUploading((n) => n + list.length);
    const failures: string[] = [];
    await Promise.all(
      list.map(async (file) => {
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch(`${base}/evidence`, { method: 'POST', body: form });
          if (!res.ok) {
            failures.push(`${file.name}: ${await readError(res)}`);
            return;
          }
          const data = await res.json();
          setEvidence((prev) => [...prev, data.evidence]);
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    if (failures.length) setErrors(failures);
  }

  /** ✕ удаляет неприкреплённую загрузку на сервере, а не только из списка. */
  async function removeEvidence(ev: EvidenceRef) {
    const res = await fetch(`${base}/evidence?evidenceId=${encodeURIComponent(ev.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setErrors([`${ev.name}: ${await readError(res)}`]);
      return;
    }
    setEvidence((prev) => prev.filter((p) => p.id !== ev.id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!status || uploading > 0) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch(`${base}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          ...(executorSelf ? { executorSelf: true } : { executorName }),
          executedAt: executedAt ? new Date(executedAt).toISOString() : null,
          actualResult,
          evidenceIds: evidence.map((ev) => ev.id),
          remark: status === 'failed' || status === 'blocked' ? remark : undefined,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      onSaved();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  }

  const needsExecution = status === 'passed' || status === 'failed';
  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-2 rounded-md border border-slate-200 p-3 dark:border-nord-3"
    >
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          Состояние*:
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AcceptanceStatus | '')}
            className="input py-1 text-xs"
            required
          >
            <option value="" disabled>
              — выберите —
            </option>
            <option value="passed">Пройдена</option>
            <option value="failed">Не пройдена</option>
            <option value="blocked">Заблокирована</option>
            <option value="not_run">Сбросить в «не проводилась»</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Дата проведения{needsExecution ? '*' : ''}:
          <input
            type="datetime-local"
            value={executedAt}
            onChange={(e) => setExecutedAt(e.target.value)}
            className="input py-1 text-xs"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={executorSelf}
            onChange={(e) => setExecutorSelf(e.target.checked)}
          />
          Исполнитель — я
        </label>
        {!executorSelf && (
          <input
            value={executorName}
            onChange={(e) => setExecutorName(e.target.value)}
            placeholder={`ФИО исполнителя${needsExecution ? '*' : ''}`}
            className="input flex-1 py-1 text-xs"
          />
        )}
      </div>
      <textarea
        value={actualResult}
        onChange={(e) => setActualResult(e.target.value)}
        placeholder={
          status === 'blocked'
            ? 'Причина блокировки*'
            : `Фактический результат${needsExecution ? '*' : ''}`
        }
        rows={2}
        className="input w-full text-xs"
      />
      {(status === 'failed' || status === 'blocked') && (
        <textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Замечание (необязательно): что нужно устранить"
          rows={2}
          className="input w-full text-xs"
        />
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="btn-secondary cursor-pointer text-xs">
          + Вложение
          <input
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.txt,.log,.csv,.json,.docx,.xlsx,.zip"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {evidence.map((ev) => (
          <span
            key={ev.id}
            className="rounded bg-slate-100 px-2 py-0.5 dark:bg-nord-1"
            title={`SHA-256 ${ev.checksum}`}
          >
            {ev.name}{' '}
            <button
              type="button"
              aria-label={`Удалить ${ev.name}`}
              onClick={() => void removeEvidence(ev)}
            >
              ✕
            </button>
          </span>
        ))}
        {uploading > 0 && (
          <span className="text-slate-500 dark:text-nord-muted">Загрузка: {uploading}…</span>
        )}
        <span className="text-slate-400 dark:text-nord-muted">до 10 МБ</span>
      </div>
      {errors.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-rose-600 dark:text-rose-400">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
      <button
        type="submit"
        disabled={busy || uploading > 0 || !status}
        className="btn-primary text-xs"
        title={!status ? 'Выберите состояние проверки' : undefined}
      >
        {busy ? 'Сохранение…' : uploading > 0 ? 'Дождитесь загрузки…' : 'Записать результат'}
      </button>
    </form>
  );
}

function RemarkRow({
  pkgId,
  check,
  remark,
  canRecord,
  onChanged,
}: {
  pkgId: string;
  check: SerializedCheck;
  remark: SerializedRemark;
  canRecord: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Подтверждает устранение последний пройденный результат после замечания.
  const retest = check.history.find(
    (h) => h.status === 'passed' && h.createdAt >= remark.createdAt,
  );

  async function act(action: 'resolve' | 'reopen' | 'verify') {
    setError(null);
    const res = await fetch(
      `/api/gost34/packages/${pkgId}/checks/${check.id}/remarks/${remark.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          retestResultId: action === 'verify' ? retest?.id : undefined,
        }),
      },
    );
    if (!res.ok) setError(await readError(res));
    else onChanged();
  }

  return (
    <li className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{REMARK_STATUS_LABELS[remark.status]}</span>
        <span className="text-slate-700 dark:text-nord-4">{remark.text}</span>
        <span className="text-slate-400 dark:text-nord-muted">
          {remark.createdBy}, {fmtDate(remark.createdAt)}
          {remark.verifiedBy && ` · проверил ${remark.verifiedBy}, ${fmtDate(remark.verifiedAt)}`}
          {remark.edits.length > 0 &&
            ` · изменено ${remark.edits.length} раз (последний — ${remark.edits[remark.edits.length - 1].editedBy})`}
        </span>
        {canRecord && remark.status === 'open' && (
          <button type="button" className="underline" onClick={() => void act('resolve')}>
            Устранено
          </button>
        )}
        {canRecord && remark.status === 'resolved' && (
          <>
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={!retest}
              title={retest ? undefined : 'Сначала запишите пройденную повторную проверку'}
              onClick={() => void act('verify')}
            >
              Проверено повторной проверкой
            </button>
            <button type="button" className="underline" onClick={() => void act('reopen')}>
              Вернуть в работу
            </button>
          </>
        )}
      </div>
      {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
    </li>
  );
}

function CheckCard({
  pkgId,
  check,
  canRecord,
  onChanged,
}: {
  pkgId: string;
  check: SerializedCheck;
  canRecord: boolean;
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const latest = check.latest;
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-nord-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-brand-700 dark:text-nord-frost3">
              {check.requirementCode}
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-nord-6">
              {check.title}
            </span>
            <StatusBadge status={check.status} />
            {check.method && (
              <span className="text-[11px] text-slate-500 dark:text-nord-muted">
                Метод: {VERIFICATION_METHOD_LABELS[check.method]}
              </span>
            )}
          </div>
          {check.criteria.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-nord-4">
              {check.criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {latest && (
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              {latest.executorName ? `Исполнитель: ${latest.executorName} · ` : ''}
              {latest.executedAt ? `Проведена: ${fmtDate(latest.executedAt)} · ` : ''}
              Записал: {latest.recordedBy}
              {latest.actualResult ? ` · ${latest.actualResult}` : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {check.history.length > 0 && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              История ({check.history.length})
            </button>
          )}
          {canRecord && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setFormOpen((v) => !v)}
            >
              {formOpen
                ? 'Отмена'
                : check.history.length
                  ? 'Повторная проверка'
                  : 'Записать результат'}
            </button>
          )}
        </div>
      </div>

      {historyOpen && (
        <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 dark:border-nord-3">
          {check.history.map((h) => (
            <li key={h.id} className="text-xs">
              <StatusBadge status={h.status} />{' '}
              <span className="text-slate-500 dark:text-nord-muted">
                записано {fmtDate(h.createdAt)} ({h.recordedBy})
                {h.executorName && ` · исполнитель ${h.executorName}`}
                {h.executedAt && ` · проведена ${fmtDate(h.executedAt)}`}
              </span>
              {h.actualResult && (
                <div className="text-slate-700 dark:text-nord-4">{h.actualResult}</div>
              )}
              {h.evidence.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {h.evidence.map((ev) => (
                    <a
                      key={ev.key}
                      className="text-brand-700 underline dark:text-nord-frost2"
                      href={`/api/gost34/packages/${pkgId}/checks/${check.id}/evidence?key=${encodeURIComponent(ev.key)}`}
                      title={`SHA-256 ${ev.checksum}`}
                    >
                      📎 {ev.name}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {check.remarks.length > 0 && (
        <ul className="mt-2 space-y-1 rounded bg-amber-50 p-2 dark:bg-amber-950/20">
          {check.remarks.map((r) => (
            <RemarkRow
              key={r.id}
              pkgId={pkgId}
              check={check}
              remark={r}
              canRecord={canRecord}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}

      {formOpen && canRecord && (
        <ResultForm
          pkgId={pkgId}
          check={check}
          onSaved={() => {
            setFormOpen(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * Испытания по утверждённой редакции комплекта: проверки по требованиям с
 * критериями приёмки, результаты с исполнителем и вложениями, замечания и
 * история. Без записанного результата проверка показывается как «не
 * проводилась» — пройденной по умолчанию она не бывает.
 */
export default function AcceptanceChecksModal({
  pkg,
  onClose,
}: {
  pkg: SerializedGostPackage;
  onClose: () => void;
}) {
  const [data, setData] = useState<ChecksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/gost34/packages/${pkg.id}/checks`);
    if (!res.ok) {
      setError(await readError(res));
      return;
    }
    setError(null);
    setData(await res.json());
  }, [pkg.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function seed() {
    setSeeding(true);
    const res = await fetch(`/api/gost34/packages/${pkg.id}/checks`, { method: 'POST' });
    setSeeding(false);
    if (!res.ok) setError(await readError(res));
    else await load();
  }

  const summary = data?.summary;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Испытания и приёмка · v{pkg.version}
            </h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              Проверки привязаны к требованиям этой редакции комплекта. Текущее состояние —
              последний записанный результат.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm font-bold text-slate-400 hover:text-slate-600 dark:hover:text-nord-4"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-6">
          {error && (
            <p className="rounded bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </p>
          )}
          {!data && !error && <p className="text-xs text-slate-500">Загрузка…</p>}
          {data && !data.eligible && (
            <p className="text-xs text-slate-600 dark:text-nord-4">
              Проверки ведутся только для утверждённой редакции комплекта.
            </p>
          )}
          {summary && summary.total > 0 && (
            <div className="flex flex-wrap gap-3 text-xs">
              <span>Всего: {summary.total}</span>
              {(Object.keys(summary.byStatus) as AcceptanceStatus[]).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <StatusBadge status={s} /> {summary.byStatus[s]}
                </span>
              ))}
              {summary.openRemarks > 0 && (
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  Незакрытых замечаний: {summary.openRemarks}
                </span>
              )}
            </div>
          )}
          {data && data.canRecord && data.pendingSeeds > 0 && (
            <div className="flex items-center justify-between rounded border border-dashed border-slate-300 p-3 text-xs dark:border-nord-3">
              <span>
                Требований с критериями приёмки без проверки: <strong>{data.pendingSeeds}</strong>
              </span>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={seeding}
                onClick={() => void seed()}
              >
                {seeding ? 'Формирование…' : 'Сформировать проверки'}
              </button>
            </div>
          )}
          {data && data.eligible && data.checks.length === 0 && data.pendingSeeds === 0 && (
            <p className="text-xs text-slate-600 dark:text-nord-4">
              В снимке комплекта нет требований с критерием приёмки или методом проверки.
            </p>
          )}
          {data?.checks.map((check) => (
            <CheckCard
              key={check.id}
              pkgId={pkg.id}
              check={check}
              canRecord={data.canRecord}
              onChanged={() => void load()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
