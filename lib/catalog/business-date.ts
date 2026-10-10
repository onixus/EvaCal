/** Default business time zone of price dates; override with BUSINESS_TIME_ZONE. */
export const DEFAULT_BUSINESS_TIME_ZONE = 'Europe/Moscow';
/**
 * Calendar date (ГГГГ-ММ-ДД) of an instant in the business time zone. Price
 * validity dates are local business dates, so a UTC slice would shift them by a
 * day around midnight.
 */
export function businessDate(instant: string | Date, timeZone?: string): string | null {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  const zone =
    timeZone ||
    (typeof process !== 'undefined' ? process.env.BUSINESS_TIME_ZONE : undefined) ||
    DEFAULT_BUSINESS_TIME_ZONE;
  const format = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  try {
    return format(zone);
  } catch {
    return format(DEFAULT_BUSINESS_TIME_ZONE);
  }
}
