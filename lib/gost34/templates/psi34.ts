import { Gost34InputPayload, Gost34Section } from '../types';
import { Gost34RequirementV2 } from '../requirements/v2';
import type { ContextGap } from '../context/types';
import {
  BLANK,
  commissionLines,
  decisionGaps,
  DECISION_LABELS,
  FACT_STATUS_LABELS,
  factResultCell,
  formatFactDate,
  protocolGaps,
  summaryLine,
  testPeriod,
} from './acceptanceFacts';

const HEADERS = [
  '№',
  'Код',
  'Проверяемое требование',
  'Критерий приемки',
  'Фактический результат',
  'Отметка',
];

/**
 * Протокол приёмо-сдаточных испытаний.
 *
 * Таблица результатов строится из журнала проверок утверждённой редакции
 * (`payload.acceptance`): у каждой строки — последний записанный результат с
 * исполнителем и датой, непроведённая проверка печатается как «не
 * проводилась». Без фактов строки остаются пустыми для комиссии. Условия
 * испытаний и выводы генератор не придумывает: выводы — только из решения
 * комиссии, иначе пустые строки.
 */
export function buildPSI34Document(payload: Gost34InputPayload): {
  sections: Gost34Section[];
  gaps: ContextGap[];
} {
  const meta = payload.metadata;
  const citations = payload.standardProfile.citations;
  const facts = payload.acceptance;
  const hasFacts = Boolean(facts && facts.checks.length > 0);

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

  const rows: (string | number)[][] = hasFacts
    ? facts!.checks.map((c, idx) => [
        idx + 1,
        c.requirementCode,
        c.title,
        c.criteria.join('; ') || 'Критерий не задан',
        factResultCell(c),
        FACT_STATUS_LABELS[c.status],
      ])
    : reqsV2.map((r, idx) => [
        idx + 1,
        r.code,
        r.title,
        r.acceptanceCriteria?.join('; ') || 'Критерий не задан',
        // Без журнала проверок результат и отметку заполняет комиссия.
        '',
        '',
      ]);

  const period = hasFacts ? testPeriod(facts!.checks) : null;
  const decision = facts?.decision ?? null;

  const conclusions: string[] = decision
    ? [
        `4.1 Результаты приемо-сдаточных испытаний системы «${meta.systemName}»: ${summaryLine(facts!.checks)}.`,
        `4.2 Решение комиссии от ${formatFactDate(decision.decidedAt)}: ${DECISION_LABELS[decision.decision]}. Основание: ${decision.basis}.`,
        ...(decision.exceptions.length
          ? [
              `4.3 Замечания, подлежащие устранению: ${decision.exceptions
                .map((e) => `${e.requirementCode} — ${e.note}`)
                .join('; ')}.`,
            ]
          : []),
      ]
    : [
        `4.1 Результат приемо-сдаточных испытаний системы «${meta.systemName}»: ${BLANK} (заполняется комиссией).`,
        `4.2 Решение комиссии: ${BLANK} (заполняется комиссией по итогам испытаний).`,
      ];

  const sections: Gost34Section[] = [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ОБЪЕКТ И ОБЩИЕ ПОЛОЖЕНИЯ',
      paragraphs: [
        `1.1 Объект испытаний: Автоматизированная система «${meta.systemName}» (далее — Система).`,
        `1.2 Настоящий протокол фиксирует фактические результаты приемо-сдаточных испытаний (ПСИ) по стандарту ${citations.testing}.`,
        `1.3 Испытания проводились в соответствии с Программой и методикой испытаний (ПМИ)${
          hasFacts ? ` редакции v${facts!.packageVersion} комплекта документации` : ''
        }.`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'УСЛОВИЯ И ПОРЯДОК ПРОВЕДЕНИЯ ИСПЫТАНИЙ',
      paragraphs: [
        `2.1 Место и контур проведения испытаний: ${BLANK} (заполняется комиссией).`,
        `2.2 Сведения о сбоях и отказах технических средств во время испытаний: ${BLANK} (заполняется комиссией).`,
        `2.3 Готовность исходных данных для испытаний: ${BLANK} (заполняется комиссией).`,
        `2.4 Период проведения испытаний: ${period ?? `${BLANK} (заполняется комиссией)`}.`,
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'РЕЗУЛЬТАТЫ ИСПЫТАНИЙ ПО ФУНКЦИОНАЛЬНЫМ И ТЕХНИЧЕСКИМ ТРЕБОВАНИЯМ',
      paragraphs: [
        '3.1 Фактические результаты выполнения тестовых сценариев приведены в Таблице 1.',
        hasFacts
          ? `3.2 По журналу проверок: ${summaryLine(facts!.checks)}.`
          : `3.2 Сводка результатов: ${BLANK} (заполняется комиссией).`,
      ],
      tables: [
        {
          caption: 'Таблица 1 — Фактические результаты проверок',
          headers: HEADERS,
          rows,
        },
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ВЫВОДЫ КОМИССИИ',
      paragraphs: [
        ...conclusions,
        decision && decision.commission.length
          ? `Состав комиссии: ${commissionLines(decision.commission).join('; ')}.`
          : `Состав комиссии: ${BLANK} (заполняется комиссией).`,
      ],
    },
  ];

  return { sections, gaps: [...protocolGaps(facts), ...decisionGaps(facts)] };
}

export function buildPSI34Sections(payload: Gost34InputPayload): Gost34Section[] {
  return buildPSI34Document(payload).sections;
}
