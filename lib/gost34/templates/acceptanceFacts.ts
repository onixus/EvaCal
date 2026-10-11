/**
 * Общие правила печати фактов испытаний в ПСИ и акте (#103 WP-4b).
 *
 * Генератор не утверждает ничего, чего нет в журнале проверок: непроведённая
 * проверка печатается как «не проводилась», выводы комиссии — только из
 * записанного решения; без решения остаются пустые строки для комиссии.
 */
import type { ContextGap } from '../context/types';
import type {
  Gost34AcceptanceCheckFact,
  Gost34AcceptanceDecisionKind,
  Gost34AcceptanceFacts,
  Gost34AcceptanceStatus,
  Gost34CommissionMember,
} from '../types';

export const FACT_STATUS_LABELS: Record<Gost34AcceptanceStatus, string> = {
  not_run: 'Не проводилась',
  passed: 'Пройдена',
  failed: 'Не пройдена',
  blocked: 'Заблокирована',
};

export const DECISION_LABELS: Record<Gost34AcceptanceDecisionKind, string> = {
  accepted: 'принять',
  accepted_with_remarks: 'принять с замечаниями',
  rejected: 'не принимать',
};

/** Пустая строка для заполнения комиссией от руки. */
export const BLANK = '____________________';

export function formatFactDate(iso: string | null | undefined): string {
  if (!iso) return BLANK;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return BLANK;
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function countByStatus(
  checks: Gost34AcceptanceCheckFact[],
): Record<Gost34AcceptanceStatus, number> {
  const counts: Record<Gost34AcceptanceStatus, number> = {
    not_run: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
  };
  for (const c of checks) counts[c.status] += 1;
  return counts;
}

/** «Всего N: пройдено a, не пройдено b, заблокировано c, не проводилось d». */
export function summaryLine(checks: Gost34AcceptanceCheckFact[]): string {
  const c = countByStatus(checks);
  return (
    `всего проверок — ${checks.length}: пройдено — ${c.passed}, не пройдено — ${c.failed}, ` +
    `заблокировано — ${c.blocked}, не проводилось — ${c.not_run}`
  );
}

/** Фактический результат для ячейки таблицы: текст, исполнитель, дата. */
export function factResultCell(check: Gost34AcceptanceCheckFact): string {
  if (check.status === 'not_run') return 'Проверка не проводилась';
  const parts = [check.actualResult?.trim() || '—'];
  const who = check.executorName?.trim();
  if (who || check.executedAt) {
    parts.push(
      `Исполнитель: ${who || BLANK}, дата: ${check.executedAt ? formatFactDate(check.executedAt) : BLANK}`,
    );
  }
  if (check.openRemarks > 0) parts.push(`Открытых замечаний: ${check.openRemarks}`);
  return parts.join('. ');
}

export function commissionLines(members: Gost34CommissionMember[]): string[] {
  return members.map((m) =>
    [m.name, m.position, m.organization].filter((v) => v && v.trim()).join(', '),
  );
}

/** Период проведения испытаний по датам записанных результатов. */
export function testPeriod(checks: Gost34AcceptanceCheckFact[]): string | null {
  const dates = checks
    .map((c) => (c.executedAt ? new Date(c.executedAt).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  if (dates.length === 0) return null;
  const from = new Date(Math.min(...dates)).toISOString();
  const to = new Date(Math.max(...dates)).toISOString();
  return `с ${formatFactDate(from)} по ${formatFactDate(to)}`;
}

/** Пробелы ПСИ: нет фактов, есть непроведённые проверки. */
export function protocolGaps(facts: Gost34AcceptanceFacts | undefined): ContextGap[] {
  if (!facts || facts.checks.length === 0) {
    return [
      {
        path: 'acceptance.results',
        label: 'Фактические результаты испытаний',
        severity: 'major',
        hint: 'Проект → Реестр ГОСТ 34 → «Испытания» у утверждённой редакции: запишите результаты проверок. Без них протокол печатается с пустыми полями для комиссии.',
      },
    ];
  }
  const gaps: ContextGap[] = [];
  if (facts.newerApprovedVersion && facts.newerApprovedVersion > facts.packageVersion) {
    gaps.push({
      path: 'acceptance.edition',
      label: `Факты испытаний взяты из редакции v${facts.packageVersion}, а последняя утверждённая — v${facts.newerApprovedVersion}`,
      severity: 'major',
      hint: 'Сформируйте проверки и запишите результаты по последней утверждённой редакции или явно выберите редакцию для протокола.',
    });
  }
  const notRun = facts.checks.filter((c) => c.status === 'not_run').length;
  if (notRun > 0) {
    gaps.push({
      path: 'acceptance.notRun',
      label: `Проверки без результата: ${notRun}`,
      severity: 'minor',
      hint: 'В протоколе они отмечены как «не проводилась».',
    });
  }
  return gaps;
}

/** Пробелы, связанные с решением комиссии (ПСИ и акт). */
export function decisionGaps(facts: Gost34AcceptanceFacts | undefined): ContextGap[] {
  if (facts?.decision) return [];
  if (facts?.decisionStale) {
    return [
      {
        path: 'acceptance.decision',
        label: 'Решение комиссии устарело',
        severity: 'major',
        hint: 'После решения записаны новые результаты проверок. Выводы не печатаются, пока комиссия не вынесет решение заново.',
      },
    ];
  }
  return [
    {
      path: 'acceptance.decision',
      label: 'Решение приёмочной комиссии',
      severity: 'major',
      hint: 'Решение не записано: выводы комиссии печатаются пустыми строками для заполнения.',
    },
  ];
}
