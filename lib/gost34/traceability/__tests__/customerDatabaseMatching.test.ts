import { describe, expect, it } from 'vitest';
import { buildTraceability } from '../engine';
import { fromGost34RequirementItem } from '../../requirements/adapters';
import type { Gost34StageItem } from '../../types';
import type { TraceLink } from '../types';

const stages: Gost34StageItem[] = [
  { id: 'db-setup', order: 1, name: 'Настройка СУБД', role: 'engineer', hours: 8 },
  { id: 'design', order: 2, name: 'Проектирование', role: 'architect', hours: 8 },
];
const requirementFor = (technology: string) => fromGost34RequirementItem({
  id: 'customer-db', code: 'ТР-01', category: 'technical', title: technology,
  description: `Использовать ${technology} версии 3.`,
});

describe('customer database vocabulary is independent of the application database', () => {
  // No infra_setup category or generic database terms may mask keyword regressions.
  it.each(['SQLite', 'sqlite', 'SQLITE', 'PostgreSQL', 'Oracle', 'ClickHouse', 'Redis'])(
    'maps a technical %s requirement to database setup', (technology) => {
      const requirement = requirementFor(technology);
      const result = buildTraceability([requirement], stages);
      expect(result.links).toEqual([{
        sourceId: requirement.id, targetId: 'db-setup', method: 'RULE',
        confidence: 0.85, approved: false,
      }]);
      expect(result.metrics).toEqual({
        totalRequirements: 1, mappedRequirements: 1,
        unmappedRequirements: 0, coveragePercentage: 100,
      });
    },
  );

  it('does not map an unrelated technical requirement to database setup', () => {
    const result = buildTraceability([requirementFor('ExampleProduct')], stages);
    expect(result.links).toEqual([]);
    expect(result.metrics.coveragePercentage).toBe(0);
  });

  it.each(['design', ''])('keeps the explicit manual decision %j for a customer database', (targetId) => {
    const requirement = requirementFor('SQLite');
    const decision: TraceLink = {
      sourceId: requirement.id, targetId, method: 'MANUAL', confidence: 1, approved: true,
    };
    const result = buildTraceability([requirement], stages, [decision]);
    expect(result.links).toEqual(targetId ? [decision] : []);
    expect(result.metrics.coveragePercentage).toBe(targetId ? 100 : 0);
  });
});
