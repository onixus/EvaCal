import { Gost34InputPayload, Gost34Section } from '../types';
import type { ContextGap } from '../context/types';
import {
  BLANK,
  commissionLines,
  decisionGaps,
  DECISION_LABELS,
  formatFactDate,
  protocolGaps,
  summaryLine,
} from './acceptanceFacts';

/**
 * Акт приёмки. Выводы о соответствии, замечаниях и принятии системы берутся
 * только из записанного решения приёмочной комиссии (`payload.acceptance`).
 * Без решения разделы результатов и заключения печатаются пустыми строками:
 * генератор не вправе объявлять систему принятой или соответствующей ТЗ.
 */
export function buildACT34Document(payload: Gost34InputPayload): {
  sections: Gost34Section[];
  gaps: ContextGap[];
} {
  const meta = payload.metadata;
  const facts = payload.acceptance;
  const decision = facts?.decision ?? null;
  const hasFacts = Boolean(facts && facts.checks.length > 0);

  const commission =
    decision && decision.commission.length
      ? `2.1 Приемочная комиссия в составе: ${commissionLines(decision.commission).join('; ')}.`
      : `2.1 Приемочная комиссия в составе: ${BLANK} (заполняется комиссией).`;

  const results: string[] = [
    hasFacts
      ? `3.1 Комиссия рассмотрела результаты приемо-сдаточных испытаний (Протокол испытаний по редакции v${facts!.packageVersion} комплекта документации): ${summaryLine(facts!.checks)}.`
      : `3.1 Результаты приемо-сдаточных испытаний (Протокол испытаний): ${BLANK} (заполняется комиссией).`,
  ];
  if (decision?.decision === 'accepted') {
    results.push('3.2 Замечаний по результатам испытаний комиссией не зафиксировано.');
  } else if (decision?.decision === 'accepted_with_remarks') {
    results.push(
      `3.2 Замечания, подлежащие устранению: ${decision.exceptions
        .map((e) => `${e.requirementCode} — ${e.note}`)
        .join('; ')}.`,
    );
  } else if (decision?.decision === 'rejected') {
    results.push(`3.2 Основание отказа в приемке: ${decision.basis}.`);
  } else {
    results.push(`3.2 Выявленные недостатки и замечания: ${BLANK} (заполняется комиссией).`);
  }

  const conclusion: string[] = decision
    ? [
        `4.1 Решение комиссии от ${formatFactDate(decision.decidedAt)}: систему «${meta.systemName}» ${DECISION_LABELS[decision.decision]}. Основание: ${decision.basis}.`,
        ...(decision.decision === 'rejected'
          ? []
          : [
              '4.2 Гарантийные обязательства вступают в силу с момента подписания настоящего Акта.',
            ]),
      ]
    : [
        `4.1 Решение комиссии по системе «${meta.systemName}»: ${BLANK} (заполняется комиссией).`,
        `4.2 ${BLANK}`,
      ];

  const sections: Gost34Section[] = [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ОБЩИЕ ПОЛОЖЕНИЯ',
      paragraphs: [
        `1.1 Настоящий акт составлен по результатам приемки работ по созданию автоматизированной системы «${meta.systemName}», выполненных Разработчиком (${meta.developerName}) для Заказчика (${meta.customerName}).`,
        `1.2 Основанием для проведения работ является Договор (шифр: ${meta.contractNumber || 'Б/Н'}) и Техническое задание (${meta.documentCode}).`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'СОСТАВ ПРИЕМОЧНОЙ КОМИССИИ И СРОКИ',
      paragraphs: [
        commission,
        `2.2 Соблюдение сроков, установленных Календарным планом: ${BLANK} (заполняется комиссией).`,
        '2.3 Предъявленная к приемке Система включает в себя программное обеспечение и комплект эксплуатационной документации.',
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'РЕЗУЛЬТАТЫ ПРИЕМКИ',
      paragraphs: results,
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ЗАКЛЮЧЕНИЕ КОМИССИИ',
      paragraphs: conclusion,
    },
  ];

  return { sections, gaps: [...protocolGaps(facts), ...decisionGaps(facts)] };
}

export function buildACT34Sections(payload: Gost34InputPayload): Gost34Section[] {
  return buildACT34Document(payload).sections;
}
