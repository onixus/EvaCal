import { Gost34InputPayload, Gost34Section } from '../types';

export function buildPZ34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const stages = payload.stages;

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ВВЕДЕНИЕ',
      paragraphs: [
        `1.1 Наименование системы: ${meta.fullSystemName}.`,
        `1.2 Обозначение документа: ${meta.documentCode}.`,
        `1.3 Заказчик: ${meta.customerName}, Разработчик: ${meta.developerName}.`,
        `1.4 Основание для разработки: ${meta.contractNumber || 'Договор на создание АС'}.`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'НАЗНАЧЕНИЕ СИСТЕМЫ И ИСХОДНЫЕ ДАННЫЕ',
      paragraphs: [
        `2.1 Пояснительная записка содержит техническое описание решений, заложенных в проект системы «${meta.systemName}».`,
        `2.2 Исходными данными являются требования Технического задания (${meta.documentCode}) и материалы предпроектного обследования.`,
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'ОПИСАНИЕ СИСТЕМЫ И ЕЁ АРХИТЕКТУРЫ',
      paragraphs: [
        '3.1 Система реализована по трехзвенной веб-архитектуре (Client-Server-Database).',
        '3.2 Клиентская часть: Single Page Application (SPA) с серверным рендерингом на базе Next.js 15 и React 18.',
        '3.3 Серверная часть: Node.js, REST API, модуль бизнес-логики и авторизации.',
        '3.4 База данных: Реляционная СУБД с ORM Prisma для обеспечения целостности данных.',
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ОПИСАНИЕ КОМПЛЕКСОВ ЗАДАЧ И ЭТАПОВ РЕАЛИЗАЦИИ',
      paragraphs: ['4.1 Архитектурное распределение этапов и трудозатрат представлено в Таблице 1.'],
      tables: [
        {
          caption: 'Таблица 1 — Состав подсистем и трудозатрат проекта',
          headers: ['№', 'Наименование этапа', 'Роль исполнителя', 'Трудоемкость (ч)'],
          rows: stages.map((s) => [s.order, s.name, s.role, s.hours]),
        },
      ],
    },
    {
      id: 'sec-5',
      numStr: '5',
      title: 'ОБЕСПЕЧЕНИЕ НАДЕЖНОСТИ И БЕЗОПАСНОСТИ',
      paragraphs: [
        '5.1 Безопасность данных обеспечивается согласно 152-ФЗ и подсистеме авторизации RBAC.',
        '5.2 Резервное копирование выполняется каждые 24 часа. Время восстановления RTO — 2 часа.',
      ],
    },
  ];
}
