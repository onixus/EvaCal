'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES, roleLabel } from '@/lib/roles';
import { CALENDAR_EXCEPTION_KINDS, DEFAULT_SHORT_DAY_HOURS } from '@/lib/calendar';
import PageHeader from '@/components/PageHeader';

interface ExceptionRow {
  id: string;
  date: string;
  kind: string;
  hours: number | null;
  note: string | null;
}

interface CalendarRow {
  id: string;
  name: string;
  isDefault: boolean;
  weekendDays: string;
  note: string | null;
  templates: number;
  exceptions: ExceptionRow[];
}

interface ReservationRow {
  id: string;
  role: string;
  from: string;
  to: string;
  hoursPerWeek: number;
  reason: string;
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const kindLabel = (kind: string) =>
  CALENDAR_EXCEPTION_KINDS.find((k) => k.value === kind)?.label ?? kind;
const fmt = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
const today = () => new Date().toISOString().slice(0, 10);

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка запроса');
}

/**
 * Производственные календари, их исключения и резервы ролей. Один и тот же
 * календарь читают Гант и ресурсный план, поэтому правка видна в обоих.
 */
export default function CalendarsAdmin({
  calendars,
  reservations,
}: {
  calendars: CalendarRow[];
  reservations: ReservationRow[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(calendars[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCalendar, setNewCalendar] = useState('');
  const [single, setSingle] = useState({ date: today(), kind: 'holiday', hours: '', note: '' });
  const [lines, setLines] = useState('');
  const [reservation, setReservation] = useState({
    role: 'engineer',
    from: today(),
    to: today(),
    hoursPerWeek: '10',
    reason: '',
  });

  const selected = calendars.find((c) => c.id === selectedId) ?? calendars[0];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const patchCalendar = (body: Record<string, unknown>) =>
    run(() =>
      send(`/api/admin/calendars/${selected.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    );

  function toggleWeekend(day: number) {
    const current = new Set(selected.weekendDays.split(',').filter(Boolean).map(Number));
    if (current.has(day)) current.delete(day);
    else current.add(day);
    patchCalendar({ weekendDays: [...current].sort().join(',') });
  }

  return (
    <div className="page">
      <PageHeader
        title="Календари и резервы"
        description={
          <>
            Праздники, переносы и сокращённые дни одинаково учитываются в Ганте расчётов и в
            ресурсном плане; резервы уменьшают ёмкость ролей.{' '}
            <Link href="/capacity" className="underline">
              Открыть план
            </Link>
          </>
        }
        actions={
          <>
            <Link href="/admin/capacity" className="btn-secondary">
              Ёмкость ролей
            </Link>
            <Link href="/admin" className="btn-secondary">
              ← Админка
            </Link>
          </>
        }
      />

      {error && (
        <div role="alert" className="card p-3 text-xs text-rose-700">
          {error}
        </div>
      )}

      <section className="card grid gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="calendar-select">
              Календарь
            </label>
            <select
              id="calendar-select"
              className="input"
              value={selected?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isDefault ? ' — по умолчанию' : ''}
                </option>
              ))}
            </select>
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await send('/api/admin/calendars', {
                  method: 'POST',
                  body: JSON.stringify({ name: newCalendar }),
                });
                setNewCalendar('');
              });
            }}
          >
            <div>
              <label className="label" htmlFor="calendar-new">
                Новый календарь
              </label>
              <input
                id="calendar-new"
                className="input"
                value={newCalendar}
                placeholder="Например, «Филиал (сб рабочая)»"
                onChange={(e) => setNewCalendar(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-secondary" disabled={busy || !newCalendar.trim()}>
              Создать
            </button>
          </form>
        </div>

        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{selected.name}</span>
              {selected.isDefault ? (
                <span className="text-xs text-emerald-700 dark:text-nord-green">по умолчанию</span>
              ) : (
                <button
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => patchCalendar({ isDefault: true })}
                >
                  Сделать основным
                </button>
              )}
              <span className="text-xs text-slate-500 dark:text-nord-muted">
                Шаблонов с этим календарём: {selected.templates}
              </span>
              <button
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  const name = prompt('Название календаря', selected.name);
                  if (name && name.trim() !== selected.name) patchCalendar({ name });
                }}
              >
                Переименовать
              </button>
              {!selected.isDefault && (
                <button
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !confirm(
                        `Удалить календарь «${selected.name}»? Шаблоны перейдут на основной.`,
                      )
                    )
                      return;
                    run(() => send(`/api/admin/calendars/${selected.id}`, { method: 'DELETE' }));
                  }}
                >
                  Удалить
                </button>
              )}
            </div>

            <div>
              <div className="label">Выходные дни недели</div>
              <div role="group" aria-label="Выходные дни недели" className="flex gap-1.5">
                {WEEKDAYS.map((label, i) => {
                  const on = selected.weekendDays.split(',').includes(String(i + 1));
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      disabled={busy}
                      className={on ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                      onClick={() => toggleWeekend(i + 1)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <form
              className="grid gap-3 sm:grid-cols-5"
              onSubmit={(e) => {
                e.preventDefault();
                run(() =>
                  send(`/api/admin/calendars/${selected.id}/exceptions`, {
                    method: 'POST',
                    body: JSON.stringify({
                      ...single,
                      hours: single.kind === 'short' && single.hours ? Number(single.hours) : null,
                    }),
                  }),
                );
              }}
            >
              <div>
                <label className="label" htmlFor="exception-date">
                  Дата
                </label>
                <input
                  id="exception-date"
                  type="date"
                  className="input"
                  value={single.date}
                  onChange={(e) => setSingle({ ...single, date: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="exception-kind">
                  Тип
                </label>
                <select
                  id="exception-kind"
                  className="input"
                  value={single.kind}
                  onChange={(e) => setSingle({ ...single, kind: e.target.value })}
                >
                  {CALENDAR_EXCEPTION_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="exception-hours">
                  Часов (из 8)
                </label>
                <input
                  id="exception-hours"
                  type="number"
                  min={0.5}
                  max={8}
                  step="0.5"
                  className="input"
                  disabled={single.kind !== 'short'}
                  placeholder={String(DEFAULT_SHORT_DAY_HOURS)}
                  value={single.hours}
                  onChange={(e) => setSingle({ ...single, hours: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="exception-note">
                  Заметка
                </label>
                <input
                  id="exception-note"
                  className="input"
                  value={single.note}
                  onChange={(e) => setSingle({ ...single, note: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  Добавить дату
                </button>
              </div>
            </form>

            <details>
              <summary className="cursor-pointer text-sm">Добавить списком</summary>
              <p className="my-2 text-xs text-slate-500 dark:text-nord-muted">
                По строке на дату: «ГГГГ-ММ-ДД тип [часы] [заметка]», тип — праздник, рабочий
                (перенос) или короткий. Например: «2027-01-01 праздник Новый год», «2027-02-20
                короткий 7». Повтор даты заменяет прежнюю запись.
              </p>
              <textarea
                className="input min-h-32 font-mono text-xs"
                aria-label="Исключения списком"
                value={lines}
                onChange={(e) => setLines(e.target.value)}
              />
              <button
                className="btn-secondary mt-2"
                disabled={busy || !lines.trim()}
                onClick={() =>
                  run(async () => {
                    await send(`/api/admin/calendars/${selected.id}/exceptions`, {
                      method: 'POST',
                      body: JSON.stringify({ lines }),
                    });
                    setLines('');
                  })
                }
              >
                Загрузить список
              </button>
            </details>

            {selected.exceptions.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-nord-muted">
                Исключений нет: рабочие дни — все, кроме выходных дней недели.
              </p>
            ) : (
              <table className="table-list">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип</th>
                    <th className="text-right">Часов</th>
                    <th>Заметка</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {selected.exceptions.map((e) => (
                    <tr key={e.id}>
                      <td className="nums">{fmt(e.date)}</td>
                      <td>{kindLabel(e.kind)}</td>
                      <td className="nums text-right">
                        {e.kind === 'short' ? (e.hours ?? DEFAULT_SHORT_DAY_HOURS) : ''}
                      </td>
                      <td className="text-xs text-slate-500 dark:text-nord-muted">
                        {e.note ?? ''}
                      </td>
                      <td className="text-right">
                        <button
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              send(
                                `/api/admin/calendars/${selected.id}/exceptions?exceptionId=${encodeURIComponent(e.id)}`,
                                { method: 'DELETE' },
                              ),
                            )
                          }
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500 dark:text-nord-muted">
            Календарей нет: Гант и план считают сб и вс выходными.
          </p>
        )}
      </section>

      <section className="card grid gap-3 p-4">
        <h2 className="font-medium">Резервы ролей</h2>
        <p className="text-xs text-slate-500 dark:text-nord-muted">
          Часы в неделю, которые роль не может отдать проектам (отпуска, пресейл, внутренние
          работы). Вычитаются из ёмкости ресурсного плана; праздники уменьшают резерв так же, как
          ёмкость.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await send('/api/admin/reservations', {
                method: 'POST',
                body: JSON.stringify({
                  ...reservation,
                  hoursPerWeek: Number(reservation.hoursPerWeek),
                }),
              });
              setReservation({ ...reservation, reason: '' });
            });
          }}
        >
          <div>
            <label className="label" htmlFor="reservation-role">
              Роль
            </label>
            <select
              id="reservation-role"
              className="input"
              value={reservation.role}
              onChange={(e) => setReservation({ ...reservation, role: e.target.value })}
            >
              {ROLES.filter((r) => r.value !== 'customer').map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reservation-from">
              С
            </label>
            <input
              id="reservation-from"
              type="date"
              className="input"
              value={reservation.from}
              onChange={(e) => setReservation({ ...reservation, from: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="reservation-to">
              По
            </label>
            <input
              id="reservation-to"
              type="date"
              className="input"
              value={reservation.to}
              onChange={(e) => setReservation({ ...reservation, to: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="reservation-hours">
              Часов/нед.
            </label>
            <input
              id="reservation-hours"
              type="number"
              min={1}
              max={400}
              className="input"
              value={reservation.hoursPerWeek}
              onChange={(e) => setReservation({ ...reservation, hoursPerWeek: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="reservation-reason">
              Причина
            </label>
            <input
              id="reservation-reason"
              className="input"
              value={reservation.reason}
              onChange={(e) => setReservation({ ...reservation, reason: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy || !reservation.reason.trim()}
            >
              Зарезервировать
            </button>
          </div>
        </form>

        {reservations.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-nord-muted">Резервов нет.</p>
        ) : (
          <table className="table-list">
            <thead>
              <tr>
                <th>Роль</th>
                <th>Период</th>
                <th className="text-right">Ч/нед.</th>
                <th>Причина</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{roleLabel(r.role)}</td>
                  <td className="nums">
                    {fmt(r.from)} — {fmt(r.to)}
                  </td>
                  <td className="nums text-right">{r.hoursPerWeek}</td>
                  <td className="text-xs text-slate-500 dark:text-nord-muted">{r.reason}</td>
                  <td className="text-right">
                    <button
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm('Удалить резерв?')) return;
                        run(() =>
                          send(`/api/admin/reservations?id=${encodeURIComponent(r.id)}`, {
                            method: 'DELETE',
                          }),
                        );
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
