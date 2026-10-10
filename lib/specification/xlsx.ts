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

/** Text cells starting with formula characters are neutralized (CSV/XLSX injection). */
function textCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

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
      textCell(section.title),
      index + 1,
      textCell(item.name),
      textCell(item.vendor),
      textCell(item.sku),
      KIND_LABELS[item.kind],
      DISPOSITION_LABELS[item.disposition],
      textCell(item.configuration),
      textCell(item.licensing),
      textCell(item.term),
      decimalCell(item.quantity),
      textCell(item.unit),
      decimalCell(item.unitPrice),
      item.currency,
      decimalCell(lineAmount(item)),
      textCell(item.source),
      textCell(item.rationale),
      item.confirmed ? 'да' : 'нет',
      textCell(item.changeReason ?? ''),
      textCell(item.id),
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
    ['Расчет', textCell(meta.calculationName)],
    ['Заказчик', textCell(meta.customer)],
    ['Редакция', snapshot.version],
    ['Статус', STATUS_LABELS[snapshot.status]],
    ['Позиций', snapshot.items.length],
    ...(snapshot.emptySupplyReason
      ? [['Обоснование отсутствия поставки', textCell(snapshot.emptySupplyReason)]]
      : []),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), SPEC_XLSX_SHEETS.info);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
