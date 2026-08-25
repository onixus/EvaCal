import { Gost34InputPayload, Gost34Section } from '../types';
import { Gost34RequirementV2, getRequirementEffectiveText } from '../requirements/v2';

export function buildRP34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const ctx = payload.projectContext;
  const reqs = payload.customRequirements || [];
  const reqsV2: Gost34RequirementV2[] =
    payload.requirementsV2 ||
    reqs.map((r) => ({
      id: r.id,
      code: r.code,
      category: r.category,
      type: 'functional',
      title: r.title,
      originalText: r.description,
      approval: { status: 'APPROVED' },
    }));

  const userRoles = ctx?.roles?.length
    ? ctx.roles
        .map(
          (r) =>
            `— ${r.name}${r.permissions?.length ? ` (права: ${r.permissions.join(', ')})` : ''}`,
        )
        .join('\n')
    : '— Оператор системы: выполнение стандартных сценариев ввода и обработки данных;\n— Аналитик / Руководитель: просмотр аналитических отчетов и выгрузка результатов.';

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ВВЕДЕНИЕ И ОБЛАСТЬ ПРИМЕНЕНИЯ',
      paragraphs: [
        `1.1 Настоящее Руководство пользователя определяет порядок эксплуатации автоматизированной системы «${meta.systemName}» (${meta.fullSystemName}).`,
        `1.2 Документ предназначен для конечных пользователей и операторов системы Заказчика (${meta.customerName}).`,
        `1.3 Разработка выполнена организацией ${meta.developerName} в соответствии с требованиями ${payload.standardProfile.citations.projectDocumentation}.`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'НАЗНАЧЕНИЕ И УСЛОВИЯ ПРИМЕНЕНИЯ',
      paragraphs: [
        `2.1 Система «${meta.systemName}» предназначена для автоматизации процессов обработки данных, расчетов и выпуска документации.`,
        '2.2 Квалификация пользователей: базовые навыки работы с веб-браузером и офисными пакетами.',
        `2.3 Категории пользователей и ролевая модель:\n${userRoles}`,
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'ПОДГОТОВКА К РАБОТЕ И АУТЕНТИФИКАЦИЯ',
      paragraphs: [
        '3.1 Запуск системы осуществляется через поддерживаемый веб-браузер (Chromium, Firefox, Яндекс Браузер) по защищенному протоколу HTTPS.',
        '3.2 Для входа в систему пользователь вводит логин и пароль в форме авторизации.',
        '3.3 При первом входе рекомендуется выполнить смену временного пароля в личном кабинете.',
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ОПИСАНИЕ ОПЕРАЦИЙ И СЦЕНАРИЕВ РАБОТЫ',
      paragraphs: [
        '4.1 Перечень доступных пользователю функциональных операций приведен в Таблице 1.',
      ],
      tables: [
        {
          caption: 'Таблица 1 — Реестр пользовательских операций и функций системы',
          headers: ['Код функции', 'Наименование операции', 'Порядок выполнения'],
          rows: reqsV2.map((r) => [r.code, r.title, getRequirementEffectiveText(r)]),
        },
      ],
    },
    {
      id: 'sec-5',
      numStr: '5',
      title: 'АВАРИЙНЫЕ СИТУАЦИИ И ДЕЙСТВИЯ ПРИ СБОЯХ',
      paragraphs: [
        '5.1 При возникновении сетевых ошибок или недоступности сервера необходимо проверить подключение к корпоративной сети.',
        '5.2 При появлении сообщений об ошибках пользователь должен зафиксировать текст ошибки и передать информацию системному администратору.',
        '5.3 Все несохраненные локальные черновики восстанавливаются из сессионного кэша приложения.',
      ],
    },
  ];
}
