import type { SpecificationItem } from './types';

/** SPEC document sections; DOCX and XLSX list rows in this order. */
export const SPEC_ITEM_SECTIONS = [
  {
    num: 2,
    title: 'ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ И ЛИЦЕНЗИИ',
    kinds: ['software', 'license', 'subscription'],
  },
  { num: 3, title: 'ОБОРУДОВАНИЕ', kinds: ['hardware'] },
  {
    num: 4,
    title: 'ПОДДЕРЖКА, УСЛУГИ И ПРОЧИЕ ПОЗИЦИИ',
    kinds: ['support', 'service', 'bundle', 'other'],
  },
] as const satisfies ReadonlyArray<{
  num: number;
  title: string;
  kinds: ReadonlyArray<SpecificationItem['kind']>;
}>;

export function specificationSections(items: SpecificationItem[]) {
  return SPEC_ITEM_SECTIONS.map((section) => ({
    ...section,
    items: items.filter((item) =>
      (section.kinds as ReadonlyArray<SpecificationItem['kind']>).includes(item.kind),
    ),
  }));
}

export const DISPOSITION_LABELS: Record<SpecificationItem['disposition'], string> = {
  supply: 'Поставляем',
  existing: 'Используем имеющееся',
  alternative: 'Предлагаем альтернативу',
};

export const STATUS_LABELS = {
  draft: 'Черновик',
  review: 'На согласовании',
  confirmed: 'Подтверждена',
  released: 'Выпущена',
} as const;
