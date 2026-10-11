import { describe, expect, it } from 'vitest';
import { prepareGost34Document } from '../generation/prepareDocument';
import type { Gost34AcceptanceFacts, Gost34Section } from '../types';

const calculation = {
  name: 'Система учёта',
  customer: 'АО «Заказчик»',
  stages: [],
  risks: [],
};

function render(docType: 'PSI' | 'ACT', acceptance?: Gost34AcceptanceFacts) {
  return prepareGost34Document(
    {
      calculation,
      acceptance,
      rawRequirements: [
        {
          id: 'r1',
          code: 'ТР-Ф-01',
          category: 'functional',
          title: 'Отчёт',
          description: 'Отчёт формируется',
          criterion: 'За 5 с',
        },
      ],
      metadataOverride: { docType },
    },
    { mode: 'export' },
  );
}

function text(sections: Gost34Section[]): string {
  const parts: string[] = [];
  const walk = (list: Gost34Section[]) => {
    for (const s of list) {
      parts.push(s.title, ...s.paragraphs);
      for (const t of s.tables ?? []) parts.push(...t.headers, ...t.rows.flat().map(String));
      walk(s.subsections ?? []);
    }
  };
  walk(sections);
  return parts.join('\n').toLowerCase();
}

const FORBIDDEN = [
  'соответствует',
  'пройдены',
  'принята',
  'не выявлено',
  'не зафиксировано',
  'в полном объеме',
];

const check = (over: Partial<Gost34AcceptanceFacts['checks'][number]> = {}) => ({
  requirementId: 'r1',
  requirementCode: 'ТР-Ф-01',
  title: 'Отчёт',
  criteria: ['За 5 с'],
  status: 'not_run' as const,
  actualResult: null,
  executorName: null,
  executedAt: null,
  openRemarks: 0,
  ...over,
});

const facts = (over: Partial<Gost34AcceptanceFacts> = {}): Gost34AcceptanceFacts => ({
  packageId: 'p1',
  packageVersion: 3,
  checks: [check()],
  decision: null,
  ...over,
});

describe('ПСИ и акт не утверждают ничего без фактов', () => {
  it.each(['PSI', 'ACT'] as const)('%s без фактов: ни «соответствует», ни «пройдены»', (doc) => {
    const { ast, diagnostics } = render(doc);
    const body = text(ast.sections);
    for (const phrase of FORBIDDEN) expect(body, phrase).not.toContain(phrase);
    expect(body).toContain('заполняется комиссией');
    expect(diagnostics.gaps.map((g) => g.path)).toEqual([
      'acceptance.results',
      'acceptance.decision',
    ]);
  });

  it.each(['PSI', 'ACT'] as const)(
    '%s с пустым набором результатов (все не проводились) тоже ничего не утверждает',
    (doc) => {
      const { ast, diagnostics } = render(doc, facts());
      const body = text(ast.sections);
      for (const phrase of FORBIDDEN) expect(body, phrase).not.toContain(phrase);
      expect(diagnostics.gaps.map((g) => g.path)).toContain('acceptance.decision');
    },
  );
});

describe('ПСИ из журнала проверок', () => {
  it('таблица заполняется фактами: результат, исполнитель, дата, отметка', () => {
    const { ast, diagnostics } = render(
      'PSI',
      facts({
        checks: [
          check({
            status: 'passed',
            actualResult: 'Отчёт за 3 с',
            executorName: 'Иванов',
            executedAt: '2026-10-28T09:00:00.000Z',
          }),
          check({ requirementId: 'r2', requirementCode: 'ТР-Ф-02', title: 'Вход', criteria: [] }),
        ],
      }),
    );
    const table = ast.sections.find((s) => s.id === 'sec-3')!.tables![0];
    expect(table.rows[0]).toEqual([
      1,
      'ТР-Ф-01',
      'Отчёт',
      'За 5 с',
      'Отчёт за 3 с. Исполнитель: Иванов, дата: 28.10.2026',
      'Пройдена',
    ]);
    expect(table.rows[1]).toEqual([
      2,
      'ТР-Ф-02',
      'Вход',
      'Критерий не задан',
      'Проверка не проводилась',
      'Не проводилась',
    ]);
    const body = text(ast.sections);
    expect(body).toContain('редакции v3');
    expect(body).toContain('с 28.10.2026 по 28.10.2026');
    expect(diagnostics.gaps.map((g) => g.path)).toEqual([
      'acceptance.notRun',
      'acceptance.decision',
    ]);
  });

  it('удалены утверждения об условиях испытаний по умолчанию', () => {
    const body = text(render('PSI', facts()).ast.sections);
    expect(body).not.toContain('сбоев');
    expect(body).not.toContain('подготовлены в полном объеме');
    expect(body).not.toContain('промышленном контурах');
  });

  it('выводы печатаются только из решения комиссии', () => {
    const decided = facts({
      checks: [
        check({
          status: 'failed',
          actualResult: '12 с',
          executorName: 'И',
          executedAt: '2026-10-28T00:00:00Z',
        }),
      ],
      decision: {
        id: 'd1',
        decision: 'accepted_with_remarks',
        commission: [{ name: 'Петров П.П.', position: 'Председатель' }],
        basis: 'Протокол заседания №1',
        exceptions: [{ requirementCode: 'ТР-Ф-01', note: 'ускорить отчёт' }],
        decidedBy: 'gap',
        decidedAt: '2026-10-29T00:00:00.000Z',
      },
    });
    const body = text(render('PSI', decided).ast.sections);
    expect(body).toContain('решение комиссии от 29.10.2026: принять с замечаниями');
    expect(body).toContain('тр-ф-01 — ускорить отчёт');
    expect(body).toContain('петров п.п., председатель');
    expect(render('PSI', decided).diagnostics.gaps).toEqual([]);
  });
});

describe('Акт приёмки', () => {
  it('без решения — пустые строки; устаревшее решение — отдельный пробел', () => {
    const { ast, diagnostics } = render('ACT', facts({ decisionStale: true }));
    expect(text(ast.sections)).not.toContain('принят');
    expect(diagnostics.gaps.find((g) => g.path === 'acceptance.decision')?.label).toBe(
      'Решение комиссии устарело',
    );
  });

  it('решение «не принимать» не объявляет систему принятой и не запускает гарантию', () => {
    const body = text(
      render(
        'ACT',
        facts({
          decision: {
            id: 'd1',
            decision: 'rejected',
            commission: [{ name: 'Петров' }],
            basis: 'Не пройдены проверки производительности',
            exceptions: [],
            decidedBy: 'gap',
            decidedAt: '2026-10-29T00:00:00.000Z',
          },
        }),
      ).ast.sections,
    );
    expect(body).toContain('не принимать');
    expect(body).toContain('основание отказа в приемке');
    expect(body).not.toContain('гарантийные');
  });

  it('решение «принять» печатает заключение и комиссию', () => {
    const body = text(
      render(
        'ACT',
        facts({
          checks: [
            check({
              status: 'passed',
              actualResult: 'ok',
              executorName: 'И',
              executedAt: '2026-10-28T00:00:00Z',
            }),
          ],
          decision: {
            id: 'd1',
            decision: 'accepted',
            commission: [{ name: 'Петров', organization: 'АО «Заказчик»' }],
            basis: 'Протокол №2',
            exceptions: [],
            decidedBy: 'gap',
            decidedAt: '2026-10-29T00:00:00.000Z',
          },
        }),
      ).ast.sections,
    );
    expect(body).toContain('систему «система учёта» принять');
    expect(body).toContain('петров, ао «заказчик»');
    expect(body).toContain('гарантийные обязательства');
    expect(body).toContain('пройдено — 1');
  });
});
