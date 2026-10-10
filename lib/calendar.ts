/**
 * Производственный календарь (#103 WP-5d): чистая логика без Prisma.
 *
 * Один и тот же календарь читают Гант (`lib/scheduling.ts`) и ресурсный план
 * (`lib/capacity.ts`), поэтому праздник, перенос или сокращённый день
 * одинаково сдвигают сроки и убирают часы из недели. Все даты — только UTC:
 * день недели и дата берутся через getUTC*, а не через локальный часовой пояс
 * сервера (раньше Гант смотрел getDay(), а план — getUTCDay(), и на сервере
 * с TZ ≠ UTC они расходились на границе суток).
 *
 * Модель дня — «доля рабочего дня» (dayFactor): 0 — выходной/праздник,
 * 1 — обычный рабочий день, 0 < f < 1 — сокращённый. Гант умножает на неё
 * длину рабочего дня шаблона, план — распределяет часы этапа и ёмкость роли.
 * Загрузка из БД — `lib/calendarData.ts`.
 */

export type CalendarExceptionKind = 'holiday' | 'workday' | 'short';

export const CALENDAR_EXCEPTION_KINDS: { value: CalendarExceptionKind; label: string }[] = [
  { value: 'holiday', label: 'Праздник / нерабочий день' },
  { value: 'workday', label: 'Рабочий выходной (перенос)' },
  { value: 'short', label: 'Сокращённый день' },
];

/** Длина стандартного рабочего дня, в которой задаются часы сокращённого дня. */
export const STANDARD_DAY_HOURS = 8;
/** Предпраздничный день по ТК РФ (ст. 95): на час короче. */
export const DEFAULT_SHORT_DAY_HOURS = 7;

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface CalendarExceptionInput {
  date: Date | string;
  kind: CalendarExceptionKind | string;
  hours?: number | null;
}

export interface WorkCalendar {
  /** ISO-дни недели (1 = пн … 7 = вс), которые по умолчанию выходные. */
  weekendDays: ReadonlySet<number>;
  /** Исключения по ключу YYYY-MM-DD (UTC). */
  exceptions: ReadonlyMap<string, { kind: CalendarExceptionKind; hours: number | null }>;
}

const DEFAULT_WEEKEND_DAYS = [6, 7];

/** Календарь без исключений с выходными сб и вс — поведение до появления календарей. */
export const STANDARD_CALENDAR: WorkCalendar = Object.freeze({
  weekendDays: new Set(DEFAULT_WEEKEND_DAYS),
  exceptions: new Map(),
});

export function isExceptionKind(value: unknown): value is CalendarExceptionKind {
  return value === 'holiday' || value === 'workday' || value === 'short';
}

/** "6,7" → [6, 7]; мусор и дубли отбрасываются; все семь дней выходными быть не могут. */
export function parseWeekendDays(raw: string | null | undefined): number[] {
  if (raw === null || raw === undefined) return [...DEFAULT_WEEKEND_DAYS];
  const days = [
    ...new Set(
      raw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7),
    ),
  ].sort((a, b) => a - b);
  return days.length >= 7 ? [...DEFAULT_WEEKEND_DAYS] : days;
}

export function formatWeekendDays(days: number[]): string {
  return parseWeekendDays(days.join(',')).join(',');
}

/** Полночь UTC того же календарного дня (по UTC). */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** YYYY-MM-DD по UTC. */
export function dateKey(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}

/** «YYYY-MM-DD» или Date → полночь UTC; null для некорректной даты. */
export function parseDateKey(value: Date | string): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : utcDay(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? d : null;
}

/** ISO-день недели по UTC: 1 = понедельник … 7 = воскресенье. */
export function isoWeekday(d: Date): number {
  return ((d.getUTCDay() + 6) % 7) + 1;
}

function clampShortHours(hours: number | null | undefined): number {
  const h = hours ?? DEFAULT_SHORT_DAY_HOURS;
  if (!Number.isFinite(h)) return DEFAULT_SHORT_DAY_HOURS;
  return Math.min(STANDARD_DAY_HOURS, Math.max(0, h));
}

export function buildWorkCalendar(input: {
  weekendDays?: string | number[] | null;
  exceptions?: CalendarExceptionInput[];
}): WorkCalendar {
  const weekend =
    input.weekendDays === undefined || input.weekendDays === null
      ? DEFAULT_WEEKEND_DAYS
      : parseWeekendDays(
          Array.isArray(input.weekendDays) ? input.weekendDays.join(',') : input.weekendDays,
        );
  const exceptions = new Map<string, { kind: CalendarExceptionKind; hours: number | null }>();
  for (const e of input.exceptions ?? []) {
    const day = parseDateKey(e.date);
    if (!day || !isExceptionKind(e.kind)) continue;
    exceptions.set(dateKey(day), {
      kind: e.kind,
      hours: e.kind === 'short' ? clampShortHours(e.hours) : null,
    });
  }
  return { weekendDays: new Set(weekend), exceptions };
}

/**
 * Доля рабочего дня: 0 — нерабочий, 1 — полный, между ними — сокращённый.
 * Исключение календаря сильнее и выходных, и `includeWeekends` шаблона:
 * праздник не становится рабочим оттого, что шаблон работает без выходных.
 */
export function dayFactor(
  d: Date,
  calendar: WorkCalendar = STANDARD_CALENDAR,
  includeWeekends = false,
): number {
  const ex = calendar.exceptions.get(dateKey(d));
  if (ex) {
    if (ex.kind === 'holiday') return 0;
    if (ex.kind === 'workday') return 1;
    return clampShortHours(ex.hours) / STANDARD_DAY_HOURS;
  }
  if (!includeWeekends && calendar.weekendDays.has(isoWeekday(d))) return 0;
  return 1;
}

export function isWorkingDay(
  d: Date,
  calendar: WorkCalendar = STANDARD_CALENDAR,
  includeWeekends = false,
): boolean {
  return dayFactor(d, calendar, includeWeekends) > 0;
}

/** Число рабочих дней обычной недели календаря (5 при выходных сб/вс). */
export function nominalWorkDaysPerWeek(calendar: WorkCalendar = STANDARD_CALENDAR): number {
  return 7 - calendar.weekendDays.size;
}

/**
 * Доля ёмкости недели, начинающейся `monday`, относительно обычной недели:
 * 1 — без исключений, 0.8 — один праздник в пятидневке, > 1 — рабочая суббота.
 * Ёмкость ролей считается по календарю без `includeWeekends` шаблона.
 */
export function weekCapacityFactor(
  monday: Date,
  calendar: WorkCalendar = STANDARD_CALENDAR,
  range?: { from: Date; to: Date },
): number {
  const nominal = nominalWorkDaysPerWeek(calendar);
  if (nominal <= 0) return 0;
  const start = utcDay(monday);
  const from = range ? utcDay(range.from).getTime() : -Infinity;
  const to = range ? utcDay(range.to).getTime() : Infinity;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const day = addUtcDays(start, i);
    if (day.getTime() < from || day.getTime() > to) continue;
    sum += dayFactor(day, calendar, false);
  }
  return sum / nominal;
}
