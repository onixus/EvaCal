import { ITEM_KINDS } from '../specification/types';
import { SpecificationError, isDecimal } from '../specification/validation';
import type { ProductInput, OfferInput } from './types';
export const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SpecificationError('Требуется объект');
  return input as Record<string, unknown>;
};
export function text(value: unknown, field: string, max = 200, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new SpecificationError(`Некорректное поле: ${field} (до ${max} символов)`);
  return value.trim();
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new SpecificationError('Требуется текущая редакция');
  return Number(value);
}
export function productInput(input: unknown): ProductInput {
  const d = object(input);
  if (!(ITEM_KINDS as readonly unknown[]).includes(d.kind))
    throw new SpecificationError('Некорректный тип позиции');
  if (!Array.isArray(d.attributes) || d.attributes.length > 30)
    throw new SpecificationError('До 30 характеристик');
  const names = new Set<string>();
  const attributes = d.attributes.map((raw) => {
    const a = object(raw);
    const name = text(a.name, 'Характеристика', 100, true);
    if (names.has(name.toLowerCase()))
      throw new SpecificationError('Названия характеристик должны быть уникальными');
    names.add(name.toLowerCase());
    return {
      name,
      value: text(a.value, 'Значение', 200, true),
      unit: text(a.unit, 'Единица характеристики', 30),
    };
  });
  // The project snapshot has a bounded configuration field.
  if (attributes.map((a) => `${a.name}: ${a.value} ${a.unit}`).join('; ').length > 1700)
    throw new SpecificationError('Сократите суммарное описание характеристик до 1700 символов');
  return {
    vendorId: text(d.vendorId, 'Вендор', 100, true),
    name: text(d.name, 'Название', 200, true),
    sku: text(d.sku, 'Артикул'),
    edition: text(d.edition, 'Редакция'),
    kind: d.kind as ProductInput['kind'],
    unit: text(d.unit, 'Единица', 100, true),
    licensing: text(d.licensing, 'Лицензирование', 1000),
    attributes,
  };
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new SpecificationError('Некорректная дата');
  return value;
}
export function offerInput(input: unknown): OfferInput {
  const d = object(input);
  if (d.unitPrice !== null && !isDecimal(d.unitPrice))
    throw new SpecificationError('Цена: десятичная строка или неизвестно');
  const currency = text(d.currency, 'Валюта', 3, true);
  if (!/^[A-Z]{3}$/.test(currency)) throw new SpecificationError('Валюта: 3 заглавные буквы');
  const priceDate = date(d.priceDate);
  const validUntil = date(d.validUntil);
  if (priceDate && validUntil && priceDate > validUntil)
    throw new SpecificationError('Срок действия раньше даты цены');
  return {
    source: text(d.source, 'Источник', 500, true),
    unitPrice: d.unitPrice as string | null,
    currency,
    region: text(d.region, 'Регион'),
    terms: text(d.terms, 'Условия', 1000),
    priceDate,
    validUntil,
  };
}
