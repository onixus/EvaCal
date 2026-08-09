import { describe, expect, it } from 'vitest';
import { analyzeAndNormalizeInput } from '../analyzer';
import { buildTZ34Document } from '../templates/tz34';
import { CURRENT_GOST34_PROFILE_ID } from '../standards';

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

function payload(extra: Record<string, unknown> = {}) {
  return analyzeAndNormalizeInput({
    calculation: calc,
    metadataOverride: { standardProfileId: CURRENT_GOST34_PROFILE_ID },
    ...extra,
  });
}

describe('ГОСТ34 regression: traceability and context normalization', () => {
  it('preserves manual traceability links in generated TZ', () => {
    const result = buildTZ34Document(
      payload({
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
          unmapped: [],
        },
        customRequirements: [
          {
            id: 'REQ-1',
            code: 'REQ-1',
            category: 'functional',
            title: 'Разработка функционала',
            description: 'Создать модуль',
          },
        ],
      })
    );

    const text = JSON.stringify(result.sections);
    expect(text).toContain('Разработка');
    expect(result.issues).toEqual([]);
  });

  it('keeps gaps instead of inventing lifecycle dates', () => {
    const result = buildTZ34Document(payload());

    expect(result.gaps.some((gap) => gap.path === 'lifecycle.startDate')).toBe(true);
    expect(result.gaps.some((gap) => gap.path === 'lifecycle.endDate')).toBe(true);
  });
});
