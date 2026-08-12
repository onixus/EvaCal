import { describe, expect, it } from 'vitest';
import { analyzeAndNormalizeInput } from '../analyzer';
import { buildTZ34Document } from '../templates/tz34';
import { CURRENT_GOST34_PROFILE_ID } from '../standards';
import type { Gost34InputPayload } from '../types';

const calc = {
  id: 'traceability-regression',
  name: 'АС тестирования трассируемости',
  customer: 'Заказчик',
  answers: JSON.stringify({
    назначение: 'Управление требованиями',
    deployment: 'on-premise',
  }),
  stages: [
    {
      id: 'stage-analysis',
      order: 1,
      name: 'Анализ требований',
      role: 'аналитик',
      hours: 20,
    },
    {
      id: 'stage-dev',
      order: 2,
      name: 'Разработка',
      role: 'разработчик',
      hours: 40,
    },
  ],
};

function basePayload(
  options: {
    calculation?: typeof calc;
    projectContext?: Parameters<typeof analyzeAndNormalizeInput>[0]['projectContext'];
  } = {},
): Gost34InputPayload {
  return analyzeAndNormalizeInput({
    calculation: options.calculation ?? calc,
    metadataOverride: {
      standardProfileId: CURRENT_GOST34_PROFILE_ID,
      enrichRequirements: false,
    },
    projectContext: options.projectContext,
    rawRequirements: [
      {
        id: 'REQ-1',
        code: 'REQ-1',
        category: 'functional',
        title: 'Разработка функционала',
        description: 'Создать модуль управления требованиями',
      },
    ],
  });
}

function traceabilityTable(result: ReturnType<typeof buildTZ34Document>) {
  const section = result.sections.find((item) => item.id === 'tz2020-work-scope');
  return section?.tables?.find((table) => table.caption?.includes('Матрица прослеживаемости'));
}

describe('ГОСТ34 regression: traceability and context normalization', () => {
  it('preserves manual traceability links in generated TZ', () => {
    const payload: Gost34InputPayload = {
      ...basePayload(),
      traceability: {
        links: [
          {
            sourceId: 'REQ-1',
            targetId: 'stage-dev',
            method: 'MANUAL',
            confidence: 1,
            approved: true,
          },
        ],
        metrics: {
          totalRequirements: 1,
          mappedRequirements: 1,
          unmappedRequirements: 0,
          coveragePercentage: 100,
        },
      },
    };

    const result = buildTZ34Document(payload);
    const table = traceabilityTable(result);
    const row = table?.rows.find((item) => item[0] === 'REQ-1');

    expect(table).toBeDefined();
    expect(row).toBeDefined();
    expect(row?.[2]).toBe('Разработка');
    expect(row?.[3]).toBe('разработчик');
  });

  it('carries wizard-confirmed links from the analyzer into the generated TZ', () => {
    const payload = analyzeAndNormalizeInput({
      calculation: calc,
      metadataOverride: {
        standardProfileId: CURRENT_GOST34_PROFILE_ID,
        enrichRequirements: false,
      },
      rawRequirements: [
        {
          id: 'REQ-1',
          code: 'REQ-1',
          category: 'functional',
          title: 'Разработка функционала',
          description: 'Создать модуль управления требованиями',
        },
      ],
      manualTraceLinks: [
        {
          sourceId: 'REQ-1',
          targetId: 'stage-analysis',
          method: 'MANUAL',
          confidence: 1,
          approved: true,
        },
      ],
    });

    expect(payload.traceability?.links).toContainEqual(
      expect.objectContaining({ sourceId: 'REQ-1', targetId: 'stage-analysis' }),
    );

    const row = traceabilityTable(buildTZ34Document(payload))?.rows.find(
      (item) => item[0] === 'REQ-1',
    );
    expect(row?.[2]).toBe('Анализ требований');
    expect(row?.[3]).toBe('аналитик');
  });

  it('keeps lifecycle gaps instead of inventing schedule dates', () => {
    const result = buildTZ34Document(basePayload());

    expect(result.gaps.some((gap) => gap.path === 'lifecycle.startDate')).toBe(true);
    expect(result.gaps.some((gap) => gap.path === 'lifecycle.endDate')).toBe(true);
  });

  it('uses infrastructure deployment override as the canonical value', () => {
    const result = buildTZ34Document(
      basePayload({
        projectContext: {
          infrastructure: { deploymentModel: 'cloud' },
        },
      }),
    );

    const text = result.sections
      .flatMap((section) => [section, ...(section.subsections || [])])
      .flatMap((section) => section.paragraphs)
      .join('\n');

    expect(text).toContain('размещение в облачной инфраструктуре');
    expect(text).not.toContain('размещение на инфраструктуре Заказчика');
  });

  it('does not reference a nonexistent work-scope table when stages are absent', () => {
    const withoutStages = {
      ...calc,
      stages: [],
    };
    const result = buildTZ34Document(basePayload({ calculation: withoutStages as typeof calc }));
    const section = result.sections.find((item) => item.id === 'tz2020-work-scope');
    const text = (section?.paragraphs || []).join('\n');

    expect(section?.tables).toBeUndefined();
    expect(text).toContain('Требует уточнения у Заказчика');
    expect(text).not.toContain('приведены в таблице настоящего раздела');
  });
});
