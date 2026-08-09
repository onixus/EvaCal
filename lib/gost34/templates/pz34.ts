import { Gost34InputPayload, Gost34Section } from '../types';

export function buildPZ34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const stages = payload.stages;
  const ctx = payload.projectContext;
  const citations = payload.standardProfile.citations;

  const archStyle = ctx?.architecture?.style || 'Трехзвенная веб-архитектура (Client-Server-Database)';
  const componentsText = ctx?.architecture?.components?.join(', ') || 'Модули системы';
  const platformsText = ctx?.infrastructure?.platforms?.join(', ') || 'Стандартные общесистемные платформы';

  const availabilityText = ctx?.availability?.availabilityTargetPercent 
    ? `Коэффициент доступности: ${ctx.availability.availabilityTargetPercent}%, RTO ≤ ${ctx.availability.rtoMinutes || 120} мин, RPO ≤ ${ctx.availability.rpoMinutes || 15} мин.`
    : 'Резервное копирование выполняется регулярно. Время восстановления соответствуют требованиям проекта.';

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
        `1.5 Документ подготовлен в соответствии с требованиями ${citations.projectDocumentation}.`,
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
        `3.1 Архитектурная модель: ${archStyle}.`,
        `3.2 Состав подсистем и компонент: ${componentsText}.`,
        `3.3 Общесистемное программное окружение: ${platformsText}.`,
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ОПИСАНИЕ КОМПЛЕКСОВ ЗАДАЧ И ЭТАПОВ РЕАЛИЗАЦИИ',
      paragraphs: ['4.1 Распределение этапов создания системы и трудозатрат представлено в Таблице 1.'],
      tables: [
        {
          caption: 'Таблица 1 — Состав этапов работ и трудозатраты проекта',
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
        '5.1 Подсистема информационной безопасности обеспечивает разграничение прав доступа (RBAC) и защиту данных.',
        `5.2 Надежность и отказоустойчивость: ${availabilityText}`,
      ],
    },
  ];
}
