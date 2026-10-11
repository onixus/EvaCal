'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MyQueue, QueueItem } from '@/lib/review/queue';
import { invalidateNavBadges } from '@/components/navBadges';

const KIND_LABELS: Record<QueueItem['kind'], string> = {
  assignment: 'Этап ревью',
  verify: 'Проверка исправления',
  returned: 'Возврат',
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function InboxClient({ initial }: { initial: MyQueue }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markRead(body: { ids: string[] } | { all: true }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/me/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Ошибка');
      const now = new Date().toISOString();
      const ids = 'ids' in body ? new Set(body.ids) : null;
      setQueue((q) => {
        const notifications = q.notifications.map((n) =>
          !n.readAt && (!ids || ids.has(n.id)) ? { ...n, readAt: now } : n,
        );
        return {
          ...q,
          notifications,
          unread: Math.max(
            0,
            q.unread -
              (ids ? q.notifications.filter((n) => !n.readAt && ids.has(n.id)).length : q.unread),
          ),
        };
      });
      invalidateNavBadges();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="inbox-tasks">
        <div className="card-head">
          <h2 id="inbox-tasks" className="card-title">
            Задачи ({queue.items.length})
          </h2>
          {queue.overdue > 0 && <span className="chip-block">просрочено: {queue.overdue}</span>}
        </div>
        {queue.items.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500 dark:text-nord-muted">
            Сейчас от вас ничего не ждут.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-nord-3" data-testid="inbox-items">
            {queue.items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className={item.overdue ? 'chip-block' : 'chip-muted'}>
                  {item.overdue ? 'просрочено' : KIND_LABELS[item.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-900 dark:text-nord-6">
                    {item.title}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-nord-muted">
                    {item.detail}
                  </span>
                </span>
                <Link href={item.href} className="btn-ghost btn-sm">
                  Открыть →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="inbox-notifications">
        <div className="card-head">
          <h2 id="inbox-notifications" className="card-title">
            Уведомления{queue.unread > 0 ? ` (непрочитанных: ${queue.unread})` : ''}
          </h2>
          {queue.unread > 0 && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => markRead({ all: true })}
            >
              Прочитать все
            </button>
          )}
        </div>
        {error && <p className="px-4 py-2 text-xs text-rose-700 dark:text-nord-redText">{error}</p>}
        {queue.notifications.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500 dark:text-nord-muted">
            Уведомлений нет.
          </p>
        ) : (
          <ul
            className="divide-y divide-slate-100 dark:divide-nord-3"
            data-testid="inbox-notifications"
          >
            {queue.notifications.map((n) => (
              <li
                key={n.id}
                className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${
                  n.readAt ? 'opacity-60' : ''
                }`}
              >
                <span
                  className={
                    n.kind === 'overdue' ? 'chip-block' : n.readAt ? 'chip-muted' : 'chip-info'
                  }
                >
                  {n.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-900 dark:text-nord-6">
                    {n.payload.packageName ?? 'Комплект'}
                    {n.payload.version ? ` v${n.payload.version}` : ''}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-nord-muted">
                    {fmtDateTime(n.createdAt)}
                    {n.payload.actor ? ` · ${n.payload.actor}` : ''}
                    {n.dueAt ? ` · срок ${new Date(n.dueAt).toLocaleDateString('ru-RU')}` : ''}
                    {n.payload.text ? ` · ${n.payload.text}` : ''}
                  </span>
                </span>
                <Link
                  href={n.href}
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    if (!n.readAt) void markRead({ ids: [n.id] });
                  }}
                >
                  Открыть →
                </Link>
                {!n.readAt && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => markRead({ ids: [n.id] })}
                  >
                    Прочитано
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
