import { ITEM_KINDS, ITEM_DISPOSITIONS, SpecificationItem, SpecificationSnapshot } from './types';

export class SpecificationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value);
}

function text(value: unknown, field: string, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new SpecificationError(`Некорректное поле «${field}» (до ${max} символов)`);
  }
  return value.trim();
}

/** Strict input validation also applies to reloaded snapshots and direct generation. */
export function parseSpecification(input: unknown): SpecificationSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecificationError('Требуется спецификация');
  }
  const data = input as Record<string, unknown>;
  if (!Number.isSafeInteger(data.version) || Number(data.version) < 0) {
    throw new SpecificationError('Некорректная версия');
  }
  if (data.status !== 'draft' && data.status !== 'confirmed') {
    throw new SpecificationError('Некорректный статус');
  }
  if (!Array.isArray(data.items) || data.items.length > 500) {
    throw new SpecificationError('Допускается до 500 позиций');
  }
  const ids = new Set<string>();
  const items: SpecificationItem[] = data.items.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SpecificationError('Некорректная строка');
    }
    const row = raw as Record<string, unknown>;
    const id = text(row.id, 'id', 100);
    if (!id || ids.has(id)) throw new SpecificationError('ID строк должны быть уникальными');
    ids.add(id);
    if (
      !(ITEM_KINDS as readonly unknown[]).includes(row.kind) ||
      !(ITEM_DISPOSITIONS as readonly unknown[]).includes(row.disposition) ||
      typeof row.confirmed !== 'boolean'
    ) {
      throw new SpecificationError('Некорректный тип, назначение или подтверждение строки');
    }
    if (row.quantity !== null && !isDecimal(row.quantity)) {
      throw new SpecificationError('Количество: неотрицательное десятичное число или неизвестно');
    }
    if (row.unitPrice !== null && !isDecimal(row.unitPrice)) {
      throw new SpecificationError('Цена: неотрицательное десятичное число или неизвестно');
    }
    const currency = text(row.currency, 'Валюта', 3);
    if (currency && !/^[A-Z]{3}$/.test(currency))
      throw new SpecificationError('Валюта: код из 3 букв');
    return {
      id,
      kind: row.kind as SpecificationItem['kind'],
      disposition: row.disposition as SpecificationItem['disposition'],
      name: text(row.name, 'Название'),
      vendor: text(row.vendor, 'Вендор'),
      sku: text(row.sku, 'Артикул'),
      quantity: row.quantity as string | null,
      unit: text(row.unit, 'Единица', 100),
      configuration: text(row.configuration, 'Характеристики'),
      licensing: text(row.licensing, 'Лицензирование'),
      term: text(row.term, 'Срок'),
      source: text(row.source, 'Источник'),
      rationale: text(row.rationale, 'Основание'),
      confirmed: row.confirmed,
      unitPrice: row.unitPrice as string | null,
      currency,
    };
  });
  return {
    version: Number(data.version),
    status: data.status,
    emptySupplyReason: text(data.emptySupplyReason, 'Причина отсутствия поставки'),
    items,
  };
}

export function specificationBlockers(spec?: SpecificationSnapshot): string[] {
  if (!spec) return ['Состав поставки не задан. Создайте и подтвердите спецификацию.'];
  const problems: string[] = [];
  if (spec.status !== 'confirmed') problems.push('Версия спецификации не подтверждена.');
  if (spec.items.length === 0 && !spec.emptySupplyReason) {
    problems.push('Подтвердите отсутствие поставки с указанием причины.');
  }
  for (const item of spec.items) {
    const prefix = item.name || item.id;
    if (item.disposition === 'alternative') {
      problems.push(`${prefix}: выберите альтернативу или удалите ее перед подтверждением.`);
      continue;
    }
    if (
      !item.name ||
      !item.unit ||
      !item.source ||
      !item.rationale ||
      item.quantity === null ||
      Number(item.quantity) <= 0 ||
      !item.confirmed
    ) {
      problems.push(
        `${prefix}: нужны название, положительное количество, единица, источник, основание и подтверждение.`,
      );
    }
    if (['software', 'license'].includes(item.kind) && !item.licensing) {
      problems.push(
        `${prefix}: укажите модель лицензирования или право использования имеющегося ПО.`,
      );
    }
    if (item.unitPrice !== null && !item.currency) problems.push(`${prefix}: укажите валюту цены.`);
  }
  return problems;
}

export function requireConfirmedSpecification(spec?: SpecificationSnapshot): void {
  const parsed = spec && parseSpecification(spec);
  const blockers = specificationBlockers(parsed);
  if (blockers.length) throw new SpecificationError(blockers.join('\n'), 409);
}
