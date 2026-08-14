import { describe, expect, it } from 'vitest';
import { buildFullTraceabilityMatrix, resolveGostSection, resolvePmiTest } from '../matrix';
import { Gost34RequirementItem, Gost34StageItem } from '../../types';

describe('Traceability Matrix Engine', () => {
  const mockRequirements: Gost34RequirementItem[] = [
    {
      id: 'req_1',
      code: 'ТР-БЕЗ-21',
      category: 'security',
      title: 'Защита персональных данных по 152-ФЗ и приказу ФСТЭК № 21',
      description: 'Система должна разграничивать доступ и шифровать ПДн.',
    },
    {
      id: 'req_2',
      code: 'ТР-ИНТ-01',
      category: 'technical',
      title: 'Интеграция с внешней учетной системой 1С по REST API',
      description: 'Обмен справочниками и заказами в формате JSON.',
    },
    {
      id: 'req_3',
      code: 'ТР-НАД-01',
      category: 'reliability',
      title: 'Отказоустойчивость и SLA 99.9%',
      description: 'Горячее резервирование нод и бэкапы.',
    },
  ];

  const mockStages: Gost34StageItem[] = [
    {
      id: 'st_1',
      order: 1,
      name: 'Настройка контура безопасности и прав',
      role: 'engineer',
      hours: 40,
      startDate: '2026-09-01',
      endDate: '2026-09-10',
    },
    {
      id: 'st_2',
      order: 2,
      name: 'Разработка интеграционного шлюза API',
      role: 'developer',
      hours: 60,
      startDate: '2026-09-11',
      endDate: '2026-09-25',
    },
  ];

  it('resolves canonical GOST 34 sections based on category and content', () => {
    const secSec = resolveGostSection(mockRequirements[0]);
    expect(secSec.code).toBe('4.1.2');
    expect(secSec.title).toContain('защите информации');

    const intSec = resolveGostSection(mockRequirements[1]);
    expect(intSec.code).toBe('4.1.6');
    expect(intSec.title).toContain('интеграционным интерфейсам');

    const relSec = resolveGostSection(mockRequirements[2]);
    expect(relSec.code).toBe('4.1.1');
    expect(relSec.title).toContain('надежности');
  });

  it('resolves corresponding PMI testing procedures', () => {
    const pmi1 = resolvePmiTest(mockRequirements[0], 1);
    expect(pmi1.testCode).toBe('ПМИ-ИБ-01');
    expect(pmi1.method).toContain('Инструментальное сканирование');

    const pmi2 = resolvePmiTest(mockRequirements[1], 2);
    expect(pmi2.testCode).toBe('ПМИ-ИНТ-02');
    expect(pmi2.testTitle).toContain('API');
  });

  it('builds complete 5-layer matrix with coverage metrics', () => {
    const matrix = buildFullTraceabilityMatrix(
      mockRequirements,
      mockStages,
      { integrations_count: '3' },
      [{ key: 'integrations_count', label: 'Количество внешних систем' }],
    );

    expect(matrix.items).toHaveLength(3);
    expect(matrix.metrics.total).toBe(3);

    // 2 are covered by stages (security and API integration), 1 unmapped (reliability)
    expect(matrix.metrics.covered).toBe(2);
    expect(matrix.metrics.unmapped).toBe(1);
    expect(matrix.metrics.coveragePercent).toBe(67);

    // Check layer linking on integration requirement
    const intItem = matrix.items.find((i) => i.code === 'ТР-ИНТ-01');
    expect(intItem).toBeDefined();
    expect(intItem?.gostSection.code).toBe('4.1.6');
    expect(intItem?.pmiTest.testCode).toBe('ПМИ-ИНТ-02');
    expect(intItem?.stage?.id).toBe('st_2');
    expect(intItem?.stage?.role).toBe('developer');
    expect(intItem?.status).toBe('covered');
  });
});
