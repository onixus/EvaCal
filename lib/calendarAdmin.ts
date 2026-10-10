/**
 * Проверка ввода админки календарей и резервов (#103 WP-5d). Чистые функции:
 * маршруты `app/api/admin/calendars` и `app/api/admin/reservations` только
 * пишут результат в БД.
 */
import {
  formatWeekendDays,
  isExceptionKind,
  parseDateKey,
  STANDARD_DAY_HOURS,
  type CalendarExceptionKind,
} from './calendar';
import { ROLES } from './roles';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

/**
 * Гонка двух «сделать основным»: частичный уникальный индекс
 * WorkCalendar_single_default_key отклоняет второй. Это конфликт (409), не 500.
 */
export function isSingleDefaultViolation(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; meta?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  const text = `${String(e.message ?? '')} ${JSON.stringify(e.meta ?? {})}`;
  return (
    (e.code === 'P2002' || e.code === '23505' || text.includes('23505')) &&
    (text.includes('WorkCalendar_single_default_key') || text.includes('isDefault'))
  );
}

export const SINGLE_DEFAULT_CONFLICT =
  'Основной календарь одновременно меняет другой администратор — обновите страницу';

export interface CalendarInput {
  name?: string;
  weekendDays?: string;
  note?: string | null;
  isDefault?: boolean;
}

/** Поля календаря; `partial` — для PATCH (обязательных полей нет). */
export function parseCalendarInput(body: unknown, partial = false): Parsed<CalendarInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: CalendarInput = {};
  if (b.name !== undefined || !partial) {
    const name = String(b.name ?? '').trim();
    if (name.length < 1 || name.length > 200) return fail('Название: от 1 до 200 символов');
    out.name = name;
  }
  if (b.weekendDays !== undefined) {
    const raw = Array.isArray(b.weekendDays) ? b.weekendDays.join(',') : String(b.weekendDays);
    const days = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
    if (days.some((n) => !Number.isInteger(n) || n < 1 || n > 7)) {
      return fail('Выходные: дни недели от 1 (пн) до 7 (вс)');
    }
    if (new Set(days).size >= 7) return fail('Хотя бы один день недели должен быть рабочим');
    out.weekendDays = days.length ? formatWeekendDays(days) : '';
  }
  if (b.note !== undefined) out.note = String(b.note ?? '').trim() || null;
  if (b.isDefault !== undefined) out.isDefault = Boolean(b.isDefault);
  return { ok: true, value: out };
}

export interface ExceptionInput {
  date: Date;
  kind: CalendarExceptionKind;
  hours: number | null;
  note: string | null;
}

export function parseExceptionInput(body: unknown): Parsed<ExceptionInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const date = parseDateKey(String(b.date ?? ''));
  if (!date) return fail('Дата в формате ГГГГ-ММ-ДД');
  if (!isExceptionKind(b.kind)) return fail('Тип: holiday, workday или short');
  let hours: number | null = null;
  if (b.kind === 'short' && b.hours !== undefined && b.hours !== null && b.hours !== '') {
    hours = Number(b.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > STANDARD_DAY_HOURS) {
      return fail(`Часы сокращённого дня: больше 0 и не более ${STANDARD_DAY_HOURS}`);
    }
  }
  return {
    ok: true,
    value: { date, kind: b.kind, hours, note: String(b.note ?? '').trim() || null },
  };
}

/**
 * Пакетный ввод исключений: строки «ГГГГ-ММ-ДД тип [часы] [заметка]»,
 * тип — holiday/workday/short или «праздник/рабочий/короткий».
 */
export function parseExceptionLines(text: string): Parsed<ExceptionInput[]> {
  const aliases: Record<string, CalendarExceptionKind> = {
    праздник: 'holiday',
    выходной: 'holiday',
    рабочий: 'workday',
    перенос: 'workday',
    короткий: 'short',
    сокращённый: 'short',
    сокращенный: 'short',
  };
  const out: ExceptionInput[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const [date, rawKind = 'holiday', ...rest] = line.split(/\s+/);
    const kind = aliases[rawKind.toLowerCase()] ?? rawKind.toLowerCase();
    let hours: string | undefined;
    if (kind === 'short' && rest.length && /^\d+([.,]\d+)?$/.test(rest[0])) {
      hours = rest.shift()!.replace(',', '.');
    }
    const parsed = parseExceptionInput({ date, kind, hours, note: rest.join(' ') });
    if (!parsed.ok) return fail(`Строка ${i + 1}: ${parsed.error}`);
    out.push(parsed.value);
  }
  if (out.length === 0) return fail('Нет ни одной строки с датой');
  if (out.length > 400) return fail('Не более 400 строк за раз');
  return { ok: true, value: out };
}

export interface ReservationInput {
  role: string;
  from: Date;
  to: Date;
  hoursPerWeek: number;
  reason: string;
}

export function parseReservationInput(body: unknown): Parsed<ReservationInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const role = String(b.role ?? '');
  if (!ROLES.some((r) => r.value === role) || role === 'customer') return fail('Недопустимая роль');
  const from = parseDateKey(String(b.from ?? ''));
  const to = parseDateKey(String(b.to ?? ''));
  if (!from || !to) return fail('Даты в формате ГГГГ-ММ-ДД');
  if (to.getTime() < from.getTime()) return fail('Дата окончания раньше даты начала');
  const hoursPerWeek = Number(b.hoursPerWeek);
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek <= 0 || hoursPerWeek > 400) {
    return fail('Часов в неделю: больше 0 и не более 400');
  }
  const reason = String(b.reason ?? '').trim();
  if (reason.length < 1 || reason.length > 500) return fail('Причина: от 1 до 500 символов');
  return { ok: true, value: { role, from, to, hoursPerWeek, reason } };
}
