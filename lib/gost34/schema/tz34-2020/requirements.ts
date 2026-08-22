import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { gapsFor, listOrGap, DEPLOYMENT_LABELS, DIRECTION_LABELS } from './utils';

export const sectionRequirements: SchemaNode = {
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
        if (context.architecture?.style)
          items.push(`Архитектура системы: ${context.architecture.style}.`);
        items.push(
          ...listOrGap(context.architecture?.components, 'Состав подсистем и компонентов'),
        );
        if (context.deploymentModel && context.deploymentModel !== 'unknown') {
          items.push(`Модель размещения системы: ${DEPLOYMENT_LABELS[context.deploymentModel]}.`);
        }
        items.push(
          ...listOrGap(
            context.roles?.map((r) => r.name),
            'Ролевая модель',
          ),
        );

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
              headers: [
                'Код требования',
                'Категория',
                'Наименование',
                'Содержание требования',
                'Источник',
              ],
              rows: reqs.map((r) => [
                r.code,
                r.category,
                r.title,
                r.description,
                r.sourceFile || 'Проектное требование',
              ]),
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
        items.push(
          ...listOrGap(
            context.dataClasses?.map((d) => d.name),
            'Информационное обеспечение — состав данных',
          ),
        );
        items.push(
          ...listOrGap(
            context.infrastructure?.platforms,
            'Программное обеспечение — платформы, заданные Заказчиком',
          ),
        );
        if (context.infrastructure?.computeResources) {
          items.push(`Техническое обеспечение: ${context.infrastructure.computeResources}.`);
        }
        if (context.infrastructure?.importSubstitution !== undefined) {
          items.push(
            context.infrastructure.importSubstitution
              ? 'Программное обеспечение подлежит выбору из единого реестра российских программ для ЭВМ и баз данных.'
              : 'Требование о применении программного обеспечения из единого реестра российских программ не предъявляется.',
          );
        }
        items.push(
          ...listOrGap(
            context.roles?.map((r) => r.name),
            'Организационное обеспечение — роли эксплуатирующего персонала',
          ),
        );

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
        if (a?.availabilityTargetPercent !== undefined)
          items.push(`Коэффициент доступности системы: не менее ${a.availabilityTargetPercent} %.`);
        if (a?.rtoMinutes !== undefined)
          items.push(`Допустимое время восстановления (RTO): не более ${a.rtoMinutes} мин.`);
        if (a?.rpoMinutes !== undefined)
          items.push(`Допустимый объём потери данных (RPO): не более ${a.rpoMinutes} мин.`);
        if (a?.serviceWindow) items.push(`Регламентное окно обслуживания: ${a.serviceWindow}.`);

        const p = context.performance;
        if (p?.concurrentUsers !== undefined)
          items.push(`Число одновременно работающих пользователей: не менее ${p.concurrentUsers}.`);
        if (p?.maxResponseTimeMs !== undefined)
          items.push(`Время отклика системы: не более ${p.maxResponseTimeMs} мс.`);
        if (p?.peakRequestsPerSecond !== undefined)
          items.push(`Пиковая нагрузка: не менее ${p.peakRequestsPerSecond} запросов в секунду.`);
        if (p?.dataVolume) items.push(`Объём обрабатываемых данных: ${p.dataVolume}.`);

        const s = context.security;
        if (s?.personalDataProcessed !== undefined) {
          items.push(
            s.personalDataProcessed
              ? 'Система обрабатывает персональные данные; состав мер защиты определяется по результатам анализа применимости нормативных требований.'
              : 'Обработка персональных данных в системе не осуществляется.',
          );
        }
        if (s?.kiiObject !== undefined) {
          items.push(
            s.kiiObject
              ? 'Система относится к объектам критической информационной инфраструктуры; требования определяются по результатам категорирования.'
              : 'Система не отнесена к объектам критической информационной инфраструктуры.',
          );
        }
        if (s?.securityClass)
          items.push(`Класс (уровень) защищённости системы: ${s.securityClass}.`);
        items.push(...listOrGap(s?.authentication, 'Требования к аутентификации пользователей'));
        items.push(
          ...listOrGap(
            s?.regulatoryScope,
            'Нормативные требования, применимость которых подтверждена',
          ),
        );

        return { items, gaps: gapsFor(context, ['availability', 'performance', 'security']) };
      },
    },
  ],
};
