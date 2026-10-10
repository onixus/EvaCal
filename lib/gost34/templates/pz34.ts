/**
 * Пояснительная записка (ПЗ) к техническому проекту.
 *
 * Структура следует РД 50-34.698-90 (п. 2.3, документ П2) и его действующему
 * преемнику ГОСТ Р 59795-2021: четыре обязательных раздела — общие положения,
 * описание процесса деятельности, основные технические решения, мероприятия
 * по подготовке объекта автоматизации к вводу системы в действие.
 *
 * Содержимое строится из ProjectContext; отсутствие данных фиксируется
 * формулировкой «Требует уточнения у Заказчика» — раздел не заполняется
 * выдуманными значениями. Обоснование выбора программных средств строится
 * только из подтверждённых позиций сохранённой спецификации проекта; реестровые
 * записи и сертификаты из статических справочников не печатаются.
 */

import { Gost34InputPayload, Gost34Section, Gost34TableData } from '../types';
import { ContextGap, formatGap } from '../context/types';
import { parseSpecification } from '../../specification/validation';
import { LICENSED_KINDS, type SpecificationItem } from '../../specification/types';

const SPEC_GAP: ContextGap = {
  path: 'specification',
  label: 'Подтверждённый состав программных средств (спецификация проекта)',
  severity: 'major',
  hint: 'Сохраните и подтвердите спецификацию; платформы и продукты не выбираются автоматически',
};

/** Подтверждённые программные позиции спецификации или undefined, если спецификация не утверждена. */
function confirmedSoftware(payload: Gost34InputPayload): SpecificationItem[] | undefined {
  if (!payload.specification) return undefined;
  let spec;
  try {
    spec = parseSpecification(payload.specification);
  } catch {
    return undefined;
  }
  if (spec.status !== 'confirmed') return undefined;
  return spec.items.filter(
    (item) =>
      item.confirmed && item.disposition !== 'alternative' && LICENSED_KINDS.includes(item.kind),
  );
}

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'входящий',
  outbound: 'исходящий',
  bidirectional: 'двунаправленный',
  unknown: 'уточняется',
};

export function buildPZ34Sections(payload: Gost34InputPayload): Gost34Section[] {
  return buildPZ34Document(payload).sections;
}

export function buildPZ34Document(payload: Gost34InputPayload): {
  sections: Gost34Section[];
  gaps: ContextGap[];
} {
  const gaps: ContextGap[] = [...(payload.projectContext?.gaps || [])];
  const meta = payload.metadata;
  const stages = payload.stages;
  const ctx = payload.projectContext;
  const citations = payload.standardProfile.citations;

  // ── 1. Общие положения ─────────────────────────────────────────────────
  const generalParagraphs: string[] = [
    `1.1 Наименование системы: ${meta.fullSystemName} (краткое наименование — «${meta.systemName}»).`,
    `1.2 Обозначение документа: ${meta.documentCode}.`,
    `1.3 Заказчик: ${meta.customerName}. Разработчик: ${meta.developerName}.`,
    `1.4 Основание для разработки: ${meta.contractNumber || 'Договор на создание АС'}.`,
    `1.5 Документ подготовлен в соответствии с требованиями ${citations.projectDocumentation}.`,
    `1.6 Исходные документы: Техническое задание на создание системы (${citations.primary}), материалы предпроектного обследования объекта автоматизации. Нормативные документы: ${citations.referencesList}`,
  ];

  const lifecycle = ctx?.lifecycle;
  if (stages.length > 0) {
    const period =
      lifecycle?.startDate && lifecycle?.endDate
        ? ` в период с ${lifecycle.startDate} по ${lifecycle.endDate}`
        : '';
    generalParagraphs.push(
      `1.7 Очередность создания системы: работы выполняются в ${stages.length} этап(ов)${period}; состав этапов и трудоемкость приведены в Таблице 1. Стадии создания системы соответствуют ${citations.lifecycle}.`,
    );
  } else {
    generalParagraphs.push(
      `1.7 ${formatGap('Очередность создания системы и состав этапов работ')}`,
    );
  }

  const generalTables: Gost34TableData[] =
    stages.length > 0
      ? [
          {
            caption: 'Таблица 1 — Состав этапов работ и трудозатраты проекта',
            headers: ['№', 'Наименование этапа', 'Роль исполнителя', 'Трудоемкость (ч)'],
            rows: stages.map((s) => [s.order, s.name, s.role, s.hours]),
          },
        ]
      : [];

  // ── 2. Описание процесса деятельности ──────────────────────────────────
  const activityParagraphs: string[] = [
    `2.1 ${
      ctx?.automationObject
        ? `Объект автоматизации: ${ctx.automationObject}.`
        : formatGap('Объект автоматизации')
    }`,
    `2.2 ${
      ctx?.systemPurpose
        ? `Назначение системы: ${ctx.systemPurpose}.`
        : formatGap('Назначение системы')
    }`,
  ];

  if (ctx?.goals && ctx.goals.length > 0) {
    activityParagraphs.push(
      `2.3 Цели создания системы: ${ctx.goals.map((g) => g.statement).join('; ')}.`,
    );
  } else {
    activityParagraphs.push(`2.3 ${formatGap('Цели создания системы')}`);
  }

  const userGroups = ctx?.users || [];
  const roles = ctx?.roles || [];
  if (userGroups.length > 0 || roles.length > 0) {
    const usersText = userGroups
      .map((u) => `${u.name}${u.approximateCount ? ` (около ${u.approximateCount} чел.)` : ''}`)
      .join('; ');
    const rolesText = roles.map((r) => r.name).join(', ');
    activityParagraphs.push(
      `2.4 Пользователи системы: ${usersText || 'состав уточняется'}. Ролевая модель: ${
        rolesText || 'уточняется при техническом проектировании'
      }.`,
    );
  } else {
    activityParagraphs.push(`2.4 ${formatGap('Группы пользователей и ролевая модель')}`);
  }

  // ── 3. Основные технические решения ────────────────────────────────────
  const archStyle =
    ctx?.architecture?.style || 'Трехзвенная веб-архитектура (Client-Server-Database)';
  const componentsText = ctx?.architecture?.components?.join(', ') || 'Модули системы';
  const platforms = ctx?.infrastructure?.platforms || [];

  const techParagraphs: string[] = [
    `3.1 Решения по структуре системы. Архитектурная модель: ${archStyle}.`,
    `3.2 Состав подсистем и компонентов: ${componentsText}.`,
  ];

  const integrations = ctx?.integrations || [];
  const techTables: Gost34TableData[] = [];
  if (integrations.length > 0) {
    techParagraphs.push('3.3 Решения по взаимосвязям со смежными системами приведены в Таблице 2.');
    techTables.push({
      caption: 'Таблица 2 — Взаимосвязи со смежными системами',
      headers: ['Смежная система', 'Направление обмена', 'Протокол', 'Формат данных'],
      rows: integrations.map((i) => [
        i.name,
        DIRECTION_LABELS[i.direction || 'unknown'],
        i.protocol || '—',
        i.dataFormat || '—',
      ]),
    });
  } else {
    techParagraphs.push(
      '3.3 Взаимосвязи со смежными системами: интеграции не заявлены либо подлежат уточнению на стадии технического проектирования.',
    );
  }

  const a = ctx?.availability;
  if (a?.availabilityTargetPercent || a?.rtoMinutes || a?.rpoMinutes) {
    const parts: string[] = [];
    if (a.availabilityTargetPercent !== undefined)
      parts.push(`коэффициент доступности не менее ${a.availabilityTargetPercent} %`);
    if (a.rtoMinutes !== undefined) parts.push(`RTO не более ${a.rtoMinutes} мин`);
    if (a.rpoMinutes !== undefined) parts.push(`RPO не более ${a.rpoMinutes} мин`);
    if (a.serviceWindow) parts.push(`регламентное окно обслуживания: ${a.serviceWindow}`);
    techParagraphs.push(
      `3.4 Решения по режимам функционирования: предусматриваются штатный, сервисный и аварийный режимы. Показатели надежности: ${parts.join(', ')}. Резервное копирование и восстановление обеспечивают соблюдение заданных RTO/RPO.`,
    );
  } else {
    techParagraphs.push(
      `3.4 Решения по режимам функционирования: предусматриваются штатный, сервисный и аварийный режимы. ${formatGap('Показатели надежности (доступность, RTO, RPO)')}`,
    );
  }

  techParagraphs.push(
    `3.5 Решения по комплексу технических средств. ${
      ctx?.infrastructure?.computeResources
        ? `Исходные данные: ${ctx.infrastructure.computeResources}.`
        : formatGap('Состав и характеристики технических средств')
    }`,
    `3.6 Решения по составу программных средств. ${
      platforms.length > 0
        ? `Общесистемное программное окружение: ${platforms.join(', ')}.`
        : formatGap('Общесистемное программное окружение')
    }`,
  );

  // Обоснование выбора ПО — только подтверждённые позиции спецификации проекта.
  const software = confirmedSoftware(payload);
  if (!software) {
    techParagraphs.push(
      `3.7 ${formatGap('Обоснование выбора программных средств')} Состав программных средств не подтверждён спецификацией проекта.`,
    );
    gaps.push(SPEC_GAP);
  } else if (software.length === 0) {
    techParagraphs.push(
      '3.7 Подтверждённая спецификация проекта не содержит программных средств и лицензий.',
    );
  } else {
    techParagraphs.push(
      '3.7 Обоснование выбора программных средств приведено в Таблице 3 по подтверждённой спецификации проекта. Сведения о реестровых записях и сертификатах автоматически не проверяются и настоящим документом не подтверждаются.',
    );
    techTables.push({
      caption: 'Таблица 3 — Обоснование выбора программных средств',
      headers: [
        'Программное средство',
        'Вендор / SKU',
        'Назначение',
        'Источник и основание выбора',
        'Реестр / сертификация',
      ],
      rows: software.map((item) => [
        item.name,
        [item.vendor, item.sku].filter(Boolean).join(' / ') || 'Не указано',
        item.disposition === 'existing' ? 'Используется имеющееся' : 'Поставляется',
        `${item.source}; ${item.rationale}`,
        'Не подтверждены',
      ]),
    });
  }

  const dataClasses = ctx?.dataClasses || [];
  if (dataClasses.length > 0) {
    techParagraphs.push(
      `3.8 Решения по информационному обеспечению. Классы обрабатываемых данных: ${dataClasses
        .map((d) => d.name)
        .join('; ')}.`,
    );
  }

  const s = ctx?.security;
  const securityParts: string[] = [
    'разграничение прав доступа на основе ролевой модели (RBAC)',
    'регистрация событий безопасности и аудит действий пользователей',
  ];
  if (s?.personalDataProcessed)
    securityParts.push('защита персональных данных в соответствии со 152-ФЗ');
  if (s?.kiiObject)
    securityParts.push(
      'выполнение требований 187-ФЗ и приказа ФСТЭК России № 239 для объектов КИИ',
    );
  if (s?.securityClass) securityParts.push(`обеспечение класса защищённости: ${s.securityClass}`);
  techParagraphs.push(`3.9 Решения по защите информации: ${securityParts.join('; ')}.`);
  if (s?.regulatoryScope && s.regulatoryScope.length > 0) {
    techParagraphs.push(
      `3.10 Нормативные требования по защите информации, применимость которых подтверждена: ${s.regulatoryScope.join('; ')}.`,
    );
  }

  // ── 4. Мероприятия по подготовке объекта автоматизации ────────────────
  const preparationParagraphs: string[] = [
    '4.1 Мероприятия по подготовке персонала: обучение пользователей и администраторов работе с системой, проверка знаний до начала опытной эксплуатации.',
    '4.2 Мероприятия по подготовке инфраструктуры: подготовка серверных помещений, каналов связи, электропитания и вычислительных ресурсов согласно требованиям технического проекта.',
    '4.3 Мероприятия по подготовке информационной базы: выверка, конвертация и загрузка исходных данных; порядок миграции согласуется с Заказчиком.',
    '4.4 Организация службы эксплуатации: назначение ответственных за эксплуатацию и сопровождение, утверждение регламентов резервного копирования и реагирования на инциденты.',
    `4.5 Ввод системы в действие выполняется по стадиям, установленным ${citations.lifecycle}: опытная эксплуатация, приёмочные испытания (${citations.testing}), промышленная эксплуатация.`,
  ];

  const sections: Gost34Section[] = [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ОБЩИЕ ПОЛОЖЕНИЯ',
      paragraphs: generalParagraphs,
      ...(generalTables.length > 0 ? { tables: generalTables } : {}),
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'ОПИСАНИЕ ПРОЦЕССА ДЕЯТЕЛЬНОСТИ',
      paragraphs: activityParagraphs,
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'ОСНОВНЫЕ ТЕХНИЧЕСКИЕ РЕШЕНИЯ',
      paragraphs: techParagraphs,
      ...(techTables.length > 0 ? { tables: techTables } : {}),
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'МЕРОПРИЯТИЯ ПО ПОДГОТОВКЕ ОБЪЕКТА АВТОМАТИЗАЦИИ К ВВОДУ СИСТЕМЫ В ДЕЙСТВИЕ',
      paragraphs: preparationParagraphs,
    },
  ];

  return { sections, gaps };
}
