/**
 * Схема технического задания по ГОСТ 34.602-2020.
 *
 * Структура задаётся деревом узлов; содержимое каждого раздела строится
 * из ProjectContext и модели требований. Никаких сведений о конкретной
 * системе (стек, инфраструктура, SLA) в схеме нет, а обозначения
 * стандартов берутся из нормативного профиля (PR-01), а не пишутся здесь.
 */

import { generateTraceabilityTable } from '../traceability';
import { ContextGap, ProjectContext } from '../context/types';
import type { CitationKey } from '../standards/types';
import { TZ_2020_PROFILE_ID, TZ_2020_SECTIONS, TZ_2020_SECTION_TITLES } from './tz34-2020-sections';
import { DocumentBuildContext, DocumentSchema, SchemaNode, SectionContent } from './types';

/** Обозначение стандарта из профиля документа — по смыслу ссылки, а не по номеру. */
function cite(c: DocumentBuildContext, key: CitationKey): string {
  return c.payload.standardProfile.citations[key];
}

/** Пробелы контекста, относящиеся к перечисленным полям. */
function gapsFor(context: ProjectContext, prefixes: string[]): ContextGap[] {
  return (context.gaps || []).filter((g) => prefixes.some((p) => g.path === p || g.path.startsWith(`${p}.`) || g.path.startsWith(`${p}[`)));
}

function listOrGap(values: string[] | undefined, label: string): string[] {
  return values && values.length > 0 ? [`${label}: ${values.join('; ')}.`] : [];
}

const sectionGeneralInfo: SchemaNode = {
  id: 'tz2020-general',
  title: TZ_2020_SECTIONS.general,
  required: true,
  build: ({ payload, context }): SectionContent => {
    const meta = payload.metadata;
    const items = [
      `Полное наименование системы: ${meta.fullSystemName}.`,
      `Краткое наименование системы: ${meta.systemName}.`,
      `Обозначение документа: ${meta.documentCode}.`,
      `Наименование Заказчика: ${meta.customerName}.`,
      `Наименование Разработчика: ${meta.developerName}.`,
    ];

    items.push(
      meta.contractNumber
        ? `Основание для проведения работ: ${meta.contractNumber}.`
        : 'Основание для проведения работ: договор между Заказчиком и Разработчиком (реквизиты уточняются при заключении).'
    );

    const start = context.lifecycle?.startDate;
    const end = context.lifecycle?.endDate;
    if (start || end) {
      items.push(
        `Плановые сроки выполнения работ: ${start ? `начало — ${start}` : 'начало уточняется'}, ${
          end ? `окончание — ${end}` : 'окончание уточняется'
        }.`
      );
    }
    items.push('Порядок оформления и предъявления Заказчику результатов работ определён разделом «Порядок контроля и приёмки АС» настоящего ТЗ.');

    return { items, gaps: start || end ? [] : gapsFor(context, ['lifecycle']) };
  },
};

const sectionGoals: SchemaNode = {
  id: 'tz2020-goals',
  title: TZ_2020_SECTIONS.goals,
  required: true,
  children: [
    {
      id: 'tz2020-goals-goals',
      title: 'Цели создания АС',
      required: true,
      build: ({ context }): SectionContent => {
        const items = (context.goals || []).map((g) => g.statement);
        const criteria = context.measurableGoalCriteria || [];
        const tables =
          criteria.length > 0
            ? [
                {
                  caption: 'Измеримые критерии достижения целей создания системы',
                  headers: ['Цель', 'Показатель', 'Целевое значение', 'Способ измерения'],
                  rows: criteria.map((c) => [
                    c.goalId || '—',
                    c.metric,
                    c.target || '—',
                    c.measurementMethod || '—',
                  ]),
                },
              ]
            : undefined;

        return { items, tables, gaps: gapsFor(context, ['goals', 'measurableGoalCriteria']) };
      },
    },
    {
      id: 'tz2020-goals-purpose',
      title: 'Назначение АС',
      required: true,
      build: ({ context }): SectionContent => {
        const items: string[] = [];
        if (context.systemPurpose) items.push(`Назначение системы: ${context.systemPurpose}.`);
        if (context.automationObject) items.push(`Автоматизируемая деятельность: ${context.automationObject}.`);
        const users = context.users || [];
        if (users.length > 0) {
          items.push(
            `Пользователи системы: ${users
              .map((u) => `${u.name}${u.approximateCount !== undefined ? ` (${u.approximateCount})` : ''}`)
              .join('; ')}.`
          );
        }
        return { items, gaps: gapsFor(context, ['systemPurpose', 'automationObject', 'users']) };
      },
    },
  ],
};

const sectionAutomationObject: SchemaNode = {
  id: 'tz2020-object',
  title: TZ_2020_SECTIONS.automationObject,
  required: true,
  build: ({ context }): SectionContent => {
    const items: string[] = [];
    if (context.automationObject) items.push(`Объект автоматизации: ${context.automationObject}.`);
    items.push(...listOrGap(context.dataClasses?.map((d) => d.name), 'Классы обрабатываемых данных'));
    items.push(...listOrGap(context.architecture?.externalSystems, 'Смежные системы объекта автоматизации'));
    items.push(...(context.architecture?.notes || []));

    const users = context.users || [];
    const tables =
      users.length > 0
        ? [
            {
              caption: 'Группы пользователей объекта автоматизации',
              headers: ['Группа пользователей', 'Ориентировочная численность', 'Характеристика'],
              rows: users.map((u) => [u.name, u.approximateCount ?? '—', u.description || '—']),
            },
          ]
        : undefined;

    return { items, tables, gaps: gapsFor(context, ['automationObject', 'dataClasses']) };
  },
};

const sectionRequirements: SchemaNode = {
  id: 'tz2020-requirements',
  title: TZ_2020_SECTIONS.requirements,
  required: true,
  children: [
    {
      id: 'tz2020-req-structure',
      title: 'Требования к структуре АС в целом',
      required: true,
      build: ({ context }): SectionContent => {
        const items: string[] = [];
        if (context.architecture?.style) items.push(`Архитектура системы: ${context.architecture.style}.`);
        items.push(...listOrGap(context.architecture?.components, 'Состав подсистем и компонентов'));
        if (context.deploymentModel && context.deploymentModel !== 'unknown') {
          items.push(`Модель размещения системы: ${DEPLOYMENT_LABELS[context.deploymentModel]}.`);
        }
        items.push(...listOrGap(context.roles?.map((r) => r.name), 'Ролевая модель'));

        const integrations = context.integrations || [];
        const tables =
          integrations.length > 0
            ? [
                {
                  caption: 'Интеграции со смежными системами',
                  headers: ['Смежная система', 'Направление обмена', 'Протокол', 'Формат данных'],
                  rows: integrations.map((i) => [
                    i.name,
                    DIRECTION_LABELS[i.direction || 'unknown'],
                    i.protocol || '—',
                    i.dataFormat || '—',
                  ]),
                },
              ]
            : undefined;

        return {
          items,
          tables,
          gaps: gapsFor(context, ['architecture', 'integrations', 'deploymentModel', 'roles']),
        };
      },
    },
    {
      id: 'tz2020-req-functions',
      title: 'Требования к функциям (задачам), выполняемым АС',
      required: true,
      build: ({ payload }): SectionContent => {
        const reqs = payload.customRequirements || [];
        if (reqs.length === 0) {
          return {
            paragraphs: [
              'Перечень требований к функциям системы формируется из согласованных требований проекта. На момент выпуска документа согласованные требования отсутствуют.',
            ],
          };
        }
        return {
          paragraphs: ['Перечень согласованных требований к функциям (задачам) системы:'],
          tables: [
            {
              caption: 'Спецификация требований к системе',
              headers: ['Код требования', 'Категория', 'Наименование', 'Содержание требования', 'Источник'],
              rows: reqs.map((r) => [r.code, r.category, r.title, r.description, r.sourceFile || 'Проектное требование']),
            },
          ],
        };
      },
    },
    {
      id: 'tz2020-req-support',
      title: 'Требования к видам обеспечения АС',
      required: true,
      build: ({ context }): SectionContent => {
        const items: string[] = [];
        items.push(...listOrGap(context.dataClasses?.map((d) => d.name), 'Информационное обеспечение — состав данных'));
        items.push(...listOrGap(context.infrastructure?.platforms, 'Программное обеспечение — платформы, заданные Заказчиком'));
        if (context.infrastructure?.computeResources) {
          items.push(`Техническое обеспечение: ${context.infrastructure.computeResources}.`);
        }
        if (context.infrastructure?.importSubstitution !== undefined) {
          items.push(
            context.infrastructure.importSubstitution
              ? 'Программное обеспечение подлежит выбору из единого реестра российских программ для ЭВМ и баз данных.'
              : 'Требование о применении программного обеспечения из единого реестра российских программ не предъявляется.'
          );
        }
        items.push(...listOrGap(context.roles?.map((r) => r.name), 'Организационное обеспечение — роли эксплуатирующего персонала'));

        return {
          items,
          gaps: gapsFor(context, ['infrastructure', 'dataClasses', 'roles']),
        };
      },
    },
    {
      id: 'tz2020-req-common-tech',
      title: 'Общие технические требования',
      required: true,
      build: ({ context }): SectionContent => {
        const items: string[] = [];
        const a = context.availability;
        if (a?.availabilityTargetPercent !== undefined) items.push(`Коэффициент доступности системы: не менее ${a.availabilityTargetPercent} %.`);
        if (a?.rtoMinutes !== undefined) items.push(`Допустимое время восстановления (RTO): не более ${a.rtoMinutes} мин.`);
        if (a?.rpoMinutes !== undefined) items.push(`Допустимый объём потери данных (RPO): не более ${a.rpoMinutes} мин.`);
        if (a?.serviceWindow) items.push(`Регламентное окно обслуживания: ${a.serviceWindow}.`);

        const p = context.performance;
        if (p?.concurrentUsers !== undefined) items.push(`Число одновременно работающих пользователей: не менее ${p.concurrentUsers}.`);
        if (p?.maxResponseTimeMs !== undefined) items.push(`Время отклика системы: не более ${p.maxResponseTimeMs} мс.`);
        if (p?.peakRequestsPerSecond !== undefined) items.push(`Пиковая нагрузка: не менее ${p.peakRequestsPerSecond} запросов в секунду.`);
        if (p?.dataVolume) items.push(`Объём обрабатываемых данных: ${p.dataVolume}.`);

        const s = context.security;
        if (s?.personalDataProcessed !== undefined) {
          items.push(
            s.personalDataProcessed
              ? 'Система обрабатывает персональные данные; состав мер защиты определяется по результатам анализа применимости нормативных требований.'
              : 'Обработка персональных данных в системе не осуществляется.'
          );
        }
        if (s?.kiiObject !== undefined) {
          items.push(
            s.kiiObject
              ? 'Система относится к объектам критической информационной инфраструктуры; требования определяются по результатам категорирования.'
              : 'Система не отнесена к объектам критической информационной инфраструктуры.'
          );
        }
        if (s?.securityClass) items.push(`Класс (уровень) защищённости системы: ${s.securityClass}.`);
        items.push(...listOrGap(s?.authentication, 'Требования к аутентификации пользователей'));
        items.push(...listOrGap(s?.regulatoryScope, 'Нормативные требования, применимость которых подтверждена'));

        return { items, gaps: gapsFor(context, ['availability', 'performance', 'security']) };
      },
    },
  ],
};

const sectionWorkScope: SchemaNode = {
  id: 'tz2020-work-scope',
  title: TZ_2020_SECTIONS.workScope,
  required: true,
  build: ({ payload }): SectionContent => {
    const stages = payload.stages || [];
    const risks = payload.risks || [];
    const reqs = payload.customRequirements || [];

    const items = ['Перечень стадий и этапов работ, их содержание и трудоёмкость приведены в таблице настоящего раздела.'];
    if (reqs.length > 0 && stages.length > 0) {
      items.push('Соответствие требований этапам работ приведено в матрице прослеживаемости.');
    }
    if (risks.length > 0) {
      items.push('Резерв трудозатрат на отработку рисков проекта приведён отдельной таблицей.');
    }

    const tables = [];
    if (stages.length > 0) {
      tables.push({
        caption: 'Состав и содержание работ по созданию системы',
        headers: ['№', 'Наименование этапа', 'Роль исполнителя', 'Трудоёмкость, ч', 'Содержание работ'],
        rows: stages.map((s) => [s.order, s.name, s.role, s.hours, s.requirements || '—']),
      });
    }
    if (reqs.length > 0 && stages.length > 0) {
      tables.push(generateTraceabilityTable(reqs, stages));
    }
    if (risks.length > 0) {
      tables.push({
        caption: 'Резерв трудозатрат на риски проекта',
        headers: ['№', 'Содержание риска', 'Резерв, ч'],
        rows: risks.map((r, idx) => [idx + 1, r.description, r.hours]),
      });
    }

    return { items, tables: tables.length > 0 ? tables : undefined };
  },
};

const sectionDevelopmentOrder: SchemaNode = {
  id: 'tz2020-development-order',
  title: TZ_2020_SECTIONS.developmentOrder,
  required: true,
  build: (c): SectionContent => {
    const { context } = c;
    const items = [
      `Стадии и этапы создания системы определяются в соответствии с ${cite(c, 'lifecycle')}.`,
    ];
    const stages = context.lifecycle?.stages || [];
    if (stages.length > 0) {
      items.push(`Последовательность этапов работ: ${stages.join(' → ')}.`);
    }
    if (context.lifecycle?.totalLaborHours !== undefined) {
      items.push(`Суммарная плановая трудоёмкость работ: ${context.lifecycle.totalLaborHours} ч.`);
    }
    items.push('Изменения настоящего ТЗ вносятся дополнением, подписываемым Заказчиком и Разработчиком.');
    return { items, gaps: gapsFor(context, ['lifecycle']) };
  },
};

const sectionAcceptance: SchemaNode = {
  id: 'tz2020-acceptance',
  title: TZ_2020_SECTIONS.acceptance,
  required: true,
  build: (c): SectionContent => {
    const { payload } = c;
    const items = [
      `Виды, состав и порядок проведения испытаний системы определяются в соответствии с ${cite(c, 'testing')}.`,
      'Приёмка системы осуществляется по результатам приёмочных испытаний, проводимых по согласованной программе и методике испытаний.',
      'Результаты приёмочных испытаний оформляются двусторонним актом.',
    ];

    const withCriteria = (payload.customRequirements || []).filter((r) => r.description && r.description.trim().length > 0);
    const tables =
      withCriteria.length > 0
        ? [
            {
              caption: 'Проверяемые требования и способ подтверждения соответствия',
              headers: ['Код требования', 'Наименование', 'Способ подтверждения'],
              rows: withCriteria.map((r) => [r.code, r.title, 'Приёмочные испытания']),
            },
          ]
        : undefined;

    return { items, tables };
  },
};

const sectionPreparation: SchemaNode = {
  id: 'tz2020-preparation',
  title: TZ_2020_SECTIONS.preparation,
  required: true,
  build: ({ context }): SectionContent => {
    const items: string[] = [];
    if (context.infrastructure?.computeResources) {
      items.push(`Заказчик обеспечивает вычислительные ресурсы: ${context.infrastructure.computeResources}.`);
    }
    items.push(...listOrGap(context.infrastructure?.platforms, 'Заказчик обеспечивает наличие программных платформ'));
    if ((context.users || []).length > 0) {
      items.push(
        `Заказчик обеспечивает выделение и обучение персонала по группам пользователей: ${(context.users || [])
          .map((u) => u.name)
          .join('; ')}.`
      );
    }
    items.push(...listOrGap(context.roles?.map((r) => r.name), 'Заказчик назначает ответственных по ролям'));

    return { items, gaps: gapsFor(context, ['infrastructure', 'users', 'roles']) };
  },
};

const sectionDocumentation: SchemaNode = {
  id: 'tz2020-documentation',
  title: TZ_2020_SECTIONS.documentation,
  required: true,
  build: (c): SectionContent => {
    const { context } = c;
    const docs = context.documentationRequirements || [];
    const items = [
      `Виды, комплектность и обозначение документов определяются в соответствии с ${cite(c, 'documentsClassifier')}.`,
    ];

    const tables =
      docs.length > 0
        ? [
            {
              caption: 'Комплект документации, разрабатываемой по проекту',
              headers: ['Обозначение', 'Наименование документа', 'Нормативное основание'],
              rows: docs.map((d) => [d.code, d.name, d.standardReference || cite(c, 'documentsClassifier')]),
            },
          ]
        : undefined;

    if (docs.length === 0) {
      items.push('Состав комплекта документации согласовывается Заказчиком и Разработчиком до начала стадии технического проектирования.');
    }

    return { items, tables, gaps: gapsFor(context, ['documentationRequirements']) };
  },
};

const sectionSources: SchemaNode = {
  id: 'tz2020-sources',
  title: TZ_2020_SECTIONS.sources,
  required: true,
  build: ({ payload }): SectionContent => {
    const profile = payload.standardProfile;
    const items: string[] = [
      `${profile.primaryStandard.title}.`,
      ...[...profile.documentStandards, ...profile.lifecycleStandards, ...profile.testingStandards].map(
        (s) => `${s.title}.`
      ),
    ];

    const vendorFiles = payload.vendorSourceFiles || [];
    if (vendorFiles.length > 0) {
      items.push(`Исходные документы Заказчика: ${vendorFiles.join('; ')}.`);
    }
    if (payload.templateName) {
      items.push(`Опросный лист проекта: «${payload.templateName}».`);
    }
    items.push(`Материалы обследования и расчёт трудозатрат проекта «${payload.systemName}».`);

    return { items };
  },
};

const appendixGaps: SchemaNode = {
  id: 'tz2020-appendix-gaps',
  title: 'СВЕДЕНИЯ, ТРЕБУЮЩИЕ УТОЧНЕНИЯ',
  appendix: true,
  includeWhen: ({ context }) => (context.gaps || []).length > 0,
  build: ({ context }): SectionContent => ({
    paragraphs: [
      'В настоящем приложении приведены сведения проектного контекста, не подтверждённые источниками на момент выпуска документа. До их уточнения соответствующие разделы ТЗ не считаются согласованными.',
    ],
    tables: [
      {
        caption: 'Перечень сведений, требующих уточнения',
        headers: ['Поле проектного контекста', 'Значимость', 'Источник данных'],
        rows: (context.gaps || []).map((g) => [g.label, SEVERITY_LABELS[g.severity], g.hint || '—']),
      },
    ],
  }),
};

const DEPLOYMENT_LABELS: Record<string, string> = {
  'on-premise': 'размещение на инфраструктуре Заказчика',
  cloud: 'размещение в облачной инфраструктуре',
  hybrid: 'гибридное размещение',
  unknown: 'уточняется',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'приём данных',
  outbound: 'передача данных',
  bidirectional: 'двусторонний обмен',
  unknown: 'уточняется',
};

const SEVERITY_LABELS: Record<string, string> = {
  blocking: 'блокирующее',
  major: 'существенное',
  minor: 'несущественное',
};

const NODES: SchemaNode[] = [
  sectionGeneralInfo,
  sectionGoals,
  sectionAutomationObject,
  sectionRequirements,
  sectionWorkScope,
  sectionDevelopmentOrder,
  sectionAcceptance,
  sectionPreparation,
  sectionDocumentation,
  sectionSources,
  appendixGaps,
];

export const TZ_SCHEMA_2020: DocumentSchema = {
  id: 'tz-gost34-602-2020',
  profileId: TZ_2020_PROFILE_ID,
  nodes: NODES,
};

export { TZ_2020_SECTIONS, TZ_2020_SECTION_TITLES } from './tz34-2020-sections';
