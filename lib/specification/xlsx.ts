import * as XLSX from 'xlsx';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import { DISPOSITION_LABELS, STATUS_LABELS, specificationSections } from './sections';
import { lineAmount, normalizeDecimal, summarizeSpecification } from './totals';

export const SPEC_XLSX_SHEETS = {
  items: 'Спецификация',
  totals: 'Итоги',
  info: 'Сведения',
} as const;

export const SPEC_XLSX_HEADERS = [
  'Раздел',
  '№',
  'Наименование',
  'Вендор',
  'Артикул / редакция',
  'Тип',
  'Назначение',
  'Характеристики',
  'Лицензирование',
  'Срок / условия',
  'Количество',
  'Единица',
  'Цена за единицу',
  'Валюта',
  'Сумма',
  'Источник',
  'Основание',
  'Подтверждено',
  'Причина изменения',
  'ID строки',
] as const;

const KIND_LABELS: Record<SpecificationItem['kind'], string> = {
  hardware: 'Оборудование',
  software: 'ПО',
  license: 'Лицензия',
  support: 'Поддержка',
  service: 'Услуга',
  other: 'Другое',
};

type Cell = string | number | null;

// Text is written as shared strings (t: 's') without formulas, so values such as
// '-10% скидка', '+7' or '=x' stay literal and round-trip unchanged; no apostrophe prefix.

/**
 * Decimal cell: a number only when the IEEE-754 double round-trips to the same
 * decimal; otherwise exact text, so the workbook never silently loses precision.
 * Unknown values stay empty cells (never 0).
 */
export function decimalCell(value: string | null): Cell {
  if (value === null) return null;
  const exact = normalizeDecimal(value);
  const n = Number(exact);
  return Number.isFinite(n) && String(n) === exact ? n : exact;
}

/** One row per SPEC table row, in SPEC section order (software → hardware → other). */
export function specificationXlsxRows(snapshot: SpecificationSnapshot): Cell[][] {
  return specificationSections(snapshot.items).flatMap((section) =>
    section.items.map((item, index) => [
      section.title,
      index + 1,
      item.name,
      item.vendor,
      item.sku,
      KIND_LABELS[item.kind],
      DISPOSITION_LABELS[item.disposition],
      item.configuration,
      item.licensing,
      item.term,
      decimalCell(item.quantity),
      item.unit,
      decimalCell(item.unitPrice),
      item.currency,
      decimalCell(lineAmount(item)),
      item.source,
      item.rationale,
      item.confirmed ? 'да' : 'нет',
      item.changeReason ?? '',
      item.id,
    ]),
  );
}

export function renderSpecificationXlsx(
  snapshot: SpecificationSnapshot,
  meta: { calculationName: string; customer: string },
): Buffer {
  const wb = XLSX.utils.book_new();
  const items = XLSX.utils.aoa_to_sheet([
    [...SPEC_XLSX_HEADERS],
    ...specificationXlsxRows(snapshot),
  ]);
  items['!cols'] = SPEC_XLSX_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, items, SPEC_XLSX_SHEETS.items);

  const totals = summarizeSpecification(snapshot);
  const totalRows: Cell[][] = [
    ['Валюта', 'Итого (точно)', 'Позиций', 'С неизвестной стоимостью', 'Полнота'],
    ...totals.map((t) => [
      t.currency || 'без валюты',
      decimalCell(t.total),
      t.includedCount,
      t.unknownCount,
      t.incomplete ? 'Неполная сумма' : 'Полная',
    ]),
    [],
    [
      'Итоги только по позициям «Поставляем», раздельно по валютам, без пересчета курсов. Сумма = количество × цена без округления; неизвестная цена или количество не равны нулю.',
    ],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(totalRows), SPEC_XLSX_SHEETS.totals);

  const info: Cell[][] = [
    ['Расчет', meta.calculationName],
    ['Заказчик', meta.customer],
    ['Редакция', snapshot.version],
    ['Статус', STATUS_LABELS[snapshot.status]],
    ['Позиций', snapshot.items.length],
    ...(snapshot.emptySupplyReason
      ? [['Обоснование отсутствия поставки', snapshot.emptySupplyReason]]
      : []),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), SPEC_XLSX_SHEETS.info);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
