import { Gost34InputPayload, Gost34Section } from '../types';
import { parseSpecification, specificationBlockers } from '../../specification/validation';
import type { SpecificationItem } from '../../specification/types';
import {
  DISPOSITION_LABELS as dispositions,
  specificationSections,
} from '../../specification/sections';
import { describeTotal, summarizeSpecification } from '../../specification/totals';

/** Questionnaire values and catalogue heuristics never become accepted supply lines. */
export function buildSPEC34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const spec = payload.specification && parseSpecification(payload.specification);
  const items = spec?.items || [];
  const blockers = specificationBlockers(spec);
  const totals = spec ? summarizeSpecification(spec) : [];
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
          : `${spec?.status === 'released' ? 'Выпущенная' : 'Подтвержденная'} спецификация, версия ${spec?.version}.`,
        ...blockers,
        ...(spec?.emptySupplyReason
          ? [`Обоснование отсутствия поставки: ${spec.emptySupplyReason}`]
          : []),
        'Позиции и сведения приведены из сохраненной проектной версии. Наличие бренда не подтверждает соответствие нормативным требованиям. Реестры и сертификаты автоматически не проверяются.',
      ],
    },
    ...specificationSections(items).map((group) => section(group.num, group.title, group.items)),
    {
      id: 'sec-5',
      numStr: '5',
      title: 'ИТОГИ ПО ВАЛЮТАМ',
      paragraphs: [
        ...(totals.length
          ? totals.map(
              (total) => `Итого ${total.currency || 'без валюты'}: ${describeTotal(total)}.`,
            )
          : ['Поставляемые позиции отсутствуют; итоговая стоимость не рассчитывается.']),
        'Итоги считаются только по позициям «Поставляем», отдельно по каждой валюте, без пересчета курсов. Сумма строки равна количеству, умноженному на цену, без промежуточного округления; итог округляется до 0,01 по правилу половины вверх только при печати, точное значение приведено в скобках. Неизвестные цена или количество не считаются нулем: такой итог помечен как неполный. Цена 0 означает бесплатную позицию.',
      ],
    },
    {
      id: 'sec-6',
      numStr: '6',
      title: 'УСЛОВИЯ И ПОДТВЕРЖДЕНИЯ',
      paragraphs: [
        'Условия гарантии, поддержки, лицензирования и комплектности определяются указанными источниками и согласованными условиями конкретной позиции. Неуказанные условия требуют уточнения.',
        'Существующие средства и альтернативы отделены от поставляемых позиций. Неизвестная цена не равна нулевой. Приведенные цены не включаются автоматически в стоимость трудозатрат КП.',
      ],
    },
  ];
}
