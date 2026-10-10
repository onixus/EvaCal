import { describe, it, expect } from 'vitest';
import { prepareGost34Document } from '../generation/prepareDocument';
import type { Gost34Section } from '../types';
import type { SpecificationItem, SpecificationSnapshot } from '../../specification/types';

/**
 * Регрессия issue #101: ПЗ и ТЗ не должны превращать количественные ответы
 * опросника в выбранные бренды, количества и реестровые реквизиты.
 */
const INVENTED = /YADRO|Аквариус|Postgres Pro|UserGate|стойк|Единый реестр|ФСТЭК №/;

const calculation = { id: 'c1', name: 'Проверка', customer: 'Тест', stages: [], risks: [] };

function prepare(
  docType: 'PZ' | 'TZ',
  answers: Record<string, unknown>,
  specification?: SpecificationSnapshot,
) {
  return prepareGost34Document(
    { calculation: { ...calculation, answers, specification }, metadataOverride: { docType } },
    { mode: 'export' },
  );
}

function sectionText(section: Gost34Section): string[] {
  return [
    section.title,
    ...section.paragraphs,
    ...(section.tables || []).flatMap((t) => [
      t.caption || '',
      ...t.headers,
      ...t.rows.flatMap((row) => row.map(String)),
    ]),
    ...(section.subsections || []).flatMap(sectionText),
  ];
}

function documentText(result: ReturnType<typeof prepare>): string {
  return result.ast.sections.flatMap(sectionText).join('\n');
}

const SCENARIOS: Array<{ answers: Record<string, unknown>; missing: string[] }> = [
  { answers: {}, missing: ['infrastructure.platforms', 'infrastructure.computeResources'] },
  {
    answers: { ngfw_clusters_count: 0 },
    missing: ['infrastructure.platforms', 'infrastructure.computeResources'],
  },
  { answers: { platform: 'PostgreSQL community' }, missing: ['infrastructure.computeResources'] },
  {
    answers: { servers_count: 4 },
    missing: ['infrastructure.platforms', 'infrastructure.computeResources'],
  },
  {
    answers: { deployment: 'cloud', platform: 'Веб-приложение' },
    missing: ['infrastructure.computeResources'],
  },
  {
    answers: { ngfw_clusters_count: 1, ngfw_ha_required: false, internet_throughput_gbps: 1 },
    missing: ['infrastructure.platforms', 'infrastructure.computeResources'],
  },
];

const CASES = SCENARIOS.flatMap((scenario) =>
  (['PZ', 'TZ'] as const).map((docType) => ({ docType, ...scenario })),
);

describe('ПЗ и ТЗ не выдумывают платформы и поставку', () => {
  it.each(CASES)('$docType $answers', ({ docType, answers, missing }) => {
    const result = prepare(docType, answers);
    const text = documentText(result);

    expect(text).not.toMatch(INVENTED);
    expect(result.diagnostics.issues).toEqual([]);

    const gapPaths = result.diagnostics.gaps.map((g) => g.path);
    for (const path of missing) expect(gapPaths).toContain(path);
    if (docType === 'PZ') expect(gapPaths).toContain('specification');
  });

  it('сохраняет явно выбранную платформу без подмены редакции', () => {
    const text = documentText(prepare('PZ', { platform: 'PostgreSQL community' }));
    expect(text).toContain('PostgreSQL community');
    expect(text).not.toContain('Postgres Pro');
  });

  it('не выводит SLA из количества серверов', () => {
    for (const docType of ['PZ', 'TZ'] as const) {
      const result = prepare(docType, { servers_count: 4 });
      expect(documentText(result)).not.toMatch(/99[.,]9|RTO не более 15|RPO не более 5/);
      expect(result.diagnostics.gaps.map((g) => g.path)).toContain('availability');
    }
  });

  it('помечает умолчания пресейл-sizing в требованиях ТЗ как допущения', () => {
    const result = prepare('TZ', {
      ngfw_clusters_count: 1,
      ngfw_ha_required: false,
      internet_throughput_gbps: 1,
    });
    const text = documentText(result);
    expect(text).toContain('целевая доступность — принято «99.99» по умолчанию');
    expect(text).toContain('запас производительности — принято «30» по умолчанию');
    const gap = result.diagnostics.gaps.find((g) => g.path === 'sizingAssumptions');
    expect(gap?.hint).toContain('пропускная способность East-West — не задано');
  });

  it('учитывает отключённый HA для NGFW', () => {
    const text = documentText(
      prepare('PZ', {
        ngfw_clusters_count: 1,
        ngfw_ha_required: false,
        internet_throughput_gbps: 1,
      }),
    );
    expect(text).toContain('1 узлов NGFW');
    expect(text).not.toContain('2 узлов NGFW');
  });
});

describe('ПЗ: обоснование выбора ПО по подтверждённой спецификации', () => {
  const base: SpecificationItem = {
    id: 'sw-1',
    kind: 'software',
    disposition: 'supply',
    name: 'Нестандартная СУБД',
    vendor: 'Новый вендор',
    sku: 'DB-1',
    quantity: '2',
    unit: 'лиц.',
    configuration: '',
    licensing: 'Бессрочная',
    term: '',
    source: 'КП поставщика № 7',
    rationale: 'Выбор Заказчика',
    confirmed: true,
    unitPrice: null,
    currency: '',
  };
  const spec = (status: SpecificationSnapshot['status']): SpecificationSnapshot => ({
    version: 3,
    status,
    emptySupplyReason: '',
    items: [
      base,
      { ...base, id: 'sw-alt', name: 'Альтернативная СУБД', disposition: 'alternative' },
      { ...base, id: 'sw-unc', name: 'Неподтверждённая СУБД', confirmed: false },
      { ...base, id: 'hw-1', name: 'Сервер', kind: 'hardware' },
    ],
  });

  it('строит таблицу только из подтверждённых программных позиций', () => {
    const result = prepare('PZ', {}, spec('confirmed'));
    const table = result.ast.sections
      .flatMap((s) => s.tables || [])
      .find((t) => t.caption?.includes('Обоснование выбора программных средств'));

    expect(table?.rows).toEqual([
      [
        'Нестандартная СУБД',
        'Новый вендор / DB-1',
        'Поставляется',
        'КП поставщика № 7; Выбор Заказчика',
        'Не подтверждены',
      ],
    ]);
    expect(result.diagnostics.gaps.map((g) => g.path)).not.toContain('specification');
    expect(documentText(result)).not.toMatch(INVENTED);
  });

  it('черновик спецификации не используется как основание выбора', () => {
    const result = prepare('PZ', {}, spec('draft'));
    const text = documentText(result);
    expect(text).not.toContain('Нестандартная СУБД');
    expect(result.diagnostics.gaps.map((g) => g.path)).toContain('specification');
  });
});
