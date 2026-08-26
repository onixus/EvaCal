/**
 * Подбор продуктов из базы знаний вендоров по проектному контексту.
 */

import { VENDOR_HARDWARE, VENDOR_SOFTWARE } from './registry';
import { QuantityRule, VendorHardwareProduct, VendorSoftwareProduct } from './types';

/**
 * Собирает текстовый контекст проекта, по которому ищутся продукты:
 * платформы из контекста, ответы опросника и наименование системы.
 */
export function buildVendorMatchText(
  platforms: string[],
  answers: Record<string, unknown>,
  systemName: string,
): string {
  return `${platforms.join(' ')} ${JSON.stringify(answers)} ${systemName}`.toLowerCase();
}

/** Продукты ПО, упомянутые в контексте проекта, в порядке базы знаний. */
export function findVendorSoftware(matchText: string): VendorSoftwareProduct[] {
  return VENDOR_SOFTWARE.filter((p) => p.match.test(matchText));
}

/** Аппаратные платформы, упомянутые в контексте проекта. */
export function findVendorHardware(matchText: string): VendorHardwareProduct[] {
  return VENDOR_HARDWARE.filter((p) => p.match.test(matchText));
}

/** Считает количество по правилу продукта и ответам опросника. */
export function quantityFromRule(
  rule: QuantityRule | undefined,
  answers: Record<string, unknown>,
): string {
  if (!rule) return '1 компл.';
  const raw = Number(answers[rule.answerKey] ?? 0) || 0;
  if (raw <= 0) return rule.fallback;
  const value = raw * (rule.multiplier ?? 1);
  return `${value} ${rule.unit}`;
}

/** Строка о правовом основании применения (реестр + сертификация). */
export function registryLine(p: VendorSoftwareProduct): string {
  return p.reestrMinTsifry
    ? `${p.reestrMinTsifry} (Единый реестр российского ПО)`
    : 'Единый реестр российского ПО (188-ФЗ)';
}

/** Максимальный возраст сверки реквизитов, после которого нужна повторная проверка. */
export const REQUISITE_MAX_AGE_DAYS = 365;

/**
 * Нужна ли повторная сверка реквизитов продукта: конкретный номер записан,
 * но давность сверки с источником превышает допустимую (или сверки не было).
 * Записи без номеров нейтральны и в сверке не нуждаются.
 */
export function requisiteNeedsReview(
  p: { reestrMinTsifry?: string; certification?: string; verifiedAt?: string },
  now: Date = new Date(),
): boolean {
  const hasNumber = /№ ?\d|СФ\//.test(`${p.reestrMinTsifry || ''} ${p.certification || ''}`);
  if (!hasNumber) return false;
  if (!p.verifiedAt) return true;
  const ageDays = (now.getTime() - new Date(p.verifiedAt).getTime()) / 86_400_000;
  return ageDays > REQUISITE_MAX_AGE_DAYS;
}
