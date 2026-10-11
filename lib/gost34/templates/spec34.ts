import { Gost34InputPayload, Gost34Section } from '../types';
import { parseSpecification, specificationBlockers } from '../../specification/validation';
import type { SpecificationItem } from '../../specification/types';
import {
  DISPOSITION_LABELS as dispositions,
  specificationSections,
} from '../../specification/sections';
import { describeTotal, summarizeSpecification } from '../../specification/totals';
import type { ContextGap } from '../context/types';
import { evidenceAsOf, evidenceGap, itemEvidenceText } from './evidence';

/** Questionnaire values and catalogue heuristics never become accepted supply lines. */
export function buildSPEC34Sections(payload: Gost34InputPayload): Gost34Section[] {
  return buildSPEC34Document(payload).sections;
}

export function buildSPEC34Document(payload: Gost34InputPayload): {
  sections: Gost34Section[];
  gaps: ContextGap[];
} {
  const asOf = evidenceAsOf(payload);
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
    'Реестры / сертификаты',
  ];
  const rows = (selected: SpecificationItem[]) =>
    selected.map((item, index) => [
      index + 1,
      item.name || 'Не указано',
      [item.vendor, item.sku].filter(Boolean).join(' / ') || 'Не указано',
      [item.configuration, item.licensing, item.term].filter(Boolean).join('; ') || 'Не указано',
      item.quantity === null ? 'Неизвестно' : `${item.quantity} ${item.unit}`,
      item.includedIn
        ? `${dispositions[item.disposition]}; в составе комплекта «${items.find((row) => row.id === item.includedIn)?.name || item.includedIn}», в итог не входит`
        : dispositions[item.disposition],
      item.unitPrice === null ? 'Цена неизвестна' : `${item.unitPrice} ${item.currency}`,
      `${item.source || 'Источник не указан'}; ${item.rationale || 'Основание не указано'}; ${item.confirmed ? 'Подтверждено пользователем' : 'Не подтверждено'}`,
      itemEvidenceText(item, asOf),
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
  const gap = spec ? evidenceGap(spec.items, asOf) : null;
  const sections: Gost34Section[] = [
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
        'Позиции и сведения приведены из сохраненной проектной версии. Наличие бренда не подтверждает соответствие нормативным требованиям. Реестры и сертификаты автоматически не проверяются: в графе «Реестры / сертификаты» приводятся только действующие подтверждения, внесенные в каталог вручную с источником и датой проверки и относящиеся к точной версии/модели подтвержденной позиции; иначе указано «Не подтверждено».',
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
        'Итоги считаются только по позициям «Поставляем», отдельно по каждой валюте; состав комплекта в итог не входит — стоимость несет строка комплекта, без пересчета курсов. Сумма строки равна количеству, умноженному на цену, без промежуточного округления; итог округляется до 0,01 по правилу половины вверх только при печати, точное значение приведено в скобках. Неизвестные цена или количество не считаются нулем: такой итог помечен как неполный. Цена 0 означает бесплатную позицию.',
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
  return { sections, gaps: gap ? [gap] : [] };
}
