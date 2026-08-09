import { describe, it, expect } from 'vitest';
import { buildTraceability, generateTraceabilityTable } from '../engine';
import { Gost34RequirementV2 } from '../../requirements/v2';
import { Gost34StageItem } from '../../types';

describe('Traceability Engine v2', () => {
  const req1: Gost34RequirementV2 = {
    id: 'r1',
    code: 'REQ-01',
    category: 'security',
    type: 'nonfunctional',
    title: 'Шифрование данных',
    originalText: 'Данные должны шифроваться',
    approval: { status: 'APPROVED' },
  };

  const req2: Gost34RequirementV2 = {
    id: 'r2',
    code: 'REQ-02',
    category: 'software',
    type: 'system',
    title: 'Выбор базы данных',
    originalText: 'СУБД должна быть PostgreSQL',
    approval: { status: 'APPROVED' },
  };

  const reqUnmapped: Gost34RequirementV2 = {
    id: 'r3',
    code: 'REQ-03',
    category: 'organizational',
    type: 'business',
    title: 'Цвет кнопок',
    originalText: 'Непонятное бизнес требование, не матчится с этапами',
    approval: { status: 'APPROVED' },
  };

  const stages: Gost34StageItem[] = [
    { id: 's1', order: 1, name: 'Этап безопасности', role: 'Инженер ИБ', hours: 10 },
    { id: 's2', order: 2, name: 'Проектирование БД', role: 'Архитектор', hours: 20 },
  ];

  it('should map requirements based on keywords and rules', () => {
    const result = buildTraceability([req1, req2], stages);

    expect(result.metrics.totalRequirements).toBe(2);
    expect(result.metrics.mappedRequirements).toBe(2);
    expect(result.metrics.unmappedRequirements).toBe(0);
    expect(result.metrics.coveragePercentage).toBe(100);

    expect(result.links).toHaveLength(2);
    
    const link1 = result.links.find(l => l.sourceId === 'r1');
    expect(link1?.targetId).toBe('s1');
    expect(link1?.method).toBe('RULE');
    expect(link1?.approved).toBe(false);

    const link2 = result.links.find(l => l.sourceId === 'r2');
    expect(link2?.targetId).toBe('s2');
  });

  it('should leave unknown requirements as UNMAPPED (no hash fallback)', () => {
    const result = buildTraceability([reqUnmapped], stages);

    expect(result.metrics.totalRequirements).toBe(1);
    expect(result.metrics.mappedRequirements).toBe(0);
    expect(result.metrics.unmappedRequirements).toBe(1);
    expect(result.metrics.coveragePercentage).toBe(0);
    expect(result.links).toHaveLength(0);
  });

  it('should prefer manual links over rules', () => {
    const manualLink = {
      sourceId: 'r1',
      targetId: 's2', // manually pointing security req to DB stage
      method: 'MANUAL' as const,
      approved: true,
      confidence: 1.0,
    };

    const result = buildTraceability([req1], stages, [manualLink]);

    expect(result.links).toHaveLength(1);
    expect(result.links[0].targetId).toBe('s2');
    expect(result.links[0].method).toBe('MANUAL');
    expect(result.links[0].approved).toBe(true);
  });

  it('should generate a table correctly handling UNMAPPED rows', () => {
    const result = buildTraceability([req1, reqUnmapped], stages);
    const table = generateTraceabilityTable([req1, reqUnmapped], stages, result);

    expect(table.rows).toHaveLength(2);
    
    // req1 row
    expect(table.rows[0][0]).toBe('REQ-01');
    expect(table.rows[0][2]).toBe('Этап безопасности'); // mapped
    
    // reqUnmapped row
    expect(table.rows[1][0]).toBe('REQ-03');
    expect(table.rows[1][2]).toBe('[НЕ РАСПРЕДЕЛЕНО]'); // unmapped
  });
});
