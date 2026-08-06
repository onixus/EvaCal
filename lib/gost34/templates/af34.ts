import { Gost34InputPayload, Gost34Section } from '../types';

export function buildAF34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const reqs = payload.customRequirements || [];

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'НАЗНАЧЕНИЕ И СОСТАВ АВТОМАТИЗИРУЕМЫХ ФУНКЦИЙ',
      paragraphs: [
        `1.1 Документ определяет функциональную структуру системы «${meta.systemName}».`,
        `1.2 Автоматизируемые функции предназначены для оптимизации трудозатрат Заказчика (${meta.customerName}).`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'ХАРАКТЕРИСТИКА ВЫПОЛНЯЕМЫХ ФУНКЦИЙ И ПОДСИСТЕМ',
      paragraphs: ['2.1 Полный реестр автоматизируемых функций приведен в Таблице 1.'],
      tables: [
        {
          caption: 'Таблица 1 — Реестр автоматизируемых функций АС',
          headers: ['Код функции', 'Наименование функции', 'Категория / Подсистема', 'Описание алгоритма'],
          rows: reqs.map((r) => [r.code, r.title, r.category, r.description]),
        },
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'СВЯЗИ МЕЖДУ ФУНКЦИЯМИ И ПОДОКРУЖЕНИЕМ',
      paragraphs: [
        '3.1 Все функции объединены единым веб-интерфейсом и СУБД.',
        '3.2 Входные данные: Ответы опросников пресейла, параметры трудозатрат и настройки шаблонов.',
        '3.3 Выходные данные: График Ганта, сводка трудозатрат, экспортные документы (ГОСТ 34, XLSX, PDF, JSON).',
      ],
    },
  ];
}
