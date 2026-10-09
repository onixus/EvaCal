import { Gost34InputPayload, Gost34Section } from '../types';
import { parseSpecification, specificationBlockers } from '../../specification/validation';
import type { SpecificationItem } from '../../specification/types';

const dispositions = {
  supply: 'Поставляем',
  existing: 'Используем имеющееся',
  alternative: 'Предлагаем альтернативу',
};

/** Questionnaire values and catalogue heuristics never become accepted supply lines. */
export function buildSPEC34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const spec = payload.specification && parseSpecification(payload.specification);
  const items = spec?.items || [];
  const blockers = specificationBlockers(spec);
  const headers = [
    '№',
    'Наименование',
    'Вендор / SKU',
    'Характеристики / лицензирование / срок',
    'Количество',
    'Назначение',
    'Цена за единицу / валюта',
    'Источник / основание / подтверждение',
  ];
  const rows = (selected: SpecificationItem[]) =>
    selected.map((item, index) => [
      index + 1,
      item.name || 'Не указано',
      [item.vendor, item.sku].filter(Boolean).join(' / ') || 'Не указано',
      [item.configuration, item.licensing, item.term].filter(Boolean).join('; ') || 'Не указано',
      item.quantity === null ? 'Неизвестно' : `${item.quantity} ${item.unit}`,
      dispositions[item.disposition],
      item.unitPrice === null ? 'Цена неизвестна' : `${item.unitPrice} ${item.currency}`,
      `${item.source || 'Источник не указан'}; ${item.rationale || 'Основание не указано'}; ${item.confirmed ? 'Подтверждено пользователем' : 'Не подтверждено'}`,
    ]);
  const section = (num: number, title: string, selected: SpecificationItem[]): Gost34Section => ({
    id: `sec-${num}`,
    numStr: String(num),
    title,
    paragraphs: selected.length ? [] : ['Позиции этой категории не заданы.'],
    tables: [
      { caption: `Таблица ${num - 1} — ${title.toLowerCase()}`, headers, rows: rows(selected) },
    ],
  });
  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'НАЗНАЧЕНИЕ И СОСТОЯНИЕ СПЕЦИФИКАЦИИ',
      paragraphs: [
        `Спецификация системы «${payload.metadata.systemName}» для ${payload.metadata.customerName}. Основание оформления: ${payload.standardProfile.citations.specificationBasis}.`,
        blockers.length
          ? 'ЧЕРНОВИК — состав поставки не утвержден. Не является основанием для закупки.'
          : `Подтвержденная спецификация, версия ${spec?.version}.`,
        ...blockers,
        ...(spec?.emptySupplyReason
          ? [`Обоснование отсутствия поставки: ${spec.emptySupplyReason}`]
          : []),
        'Позиции и сведения приведены из сохраненной проектной версии. Наличие бренда не подтверждает соответствие нормативным требованиям. Реестры и сертификаты автоматически не проверяются.',
      ],
    },
    section(
      2,
      'ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ И ЛИЦЕНЗИИ',
      items.filter((i) => ['software', 'license'].includes(i.kind)),
    ),
    section(
      3,
      'ОБОРУДОВАНИЕ',
      items.filter((i) => i.kind === 'hardware'),
    ),
    section(
      4,
      'ПОДДЕРЖКА, УСЛУГИ И ПРОЧИЕ ПОЗИЦИИ',
      items.filter((i) => ['support', 'service', 'other'].includes(i.kind)),
    ),
    {
      id: 'sec-5',
      numStr: '5',
      title: 'УСЛОВИЯ И ПОДТВЕРЖДЕНИЯ',
      paragraphs: [
        'Условия гарантии, поддержки, лицензирования и комплектности определяются указанными источниками и согласованными условиями конкретной позиции. Неуказанные условия требуют уточнения.',
        'Существующие средства и альтернативы отделены от поставляемых позиций. Неизвестная цена не равна нулевой. Приведенные цены не включаются автоматически в стоимость трудозатрат КП.',
      ],
    },
  ];
}
