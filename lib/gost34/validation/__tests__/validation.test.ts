import { describe, it, expect } from 'vitest';
import type { Gost34RequirementV2 } from '../../requirements';
import { validateRequirements, validateRequirement, formatValidationFinding } from '../index';
import type { ValidationFinding, ValidationRuleId } from '../types';

function makeRequirement(overrides: Partial<Gost34RequirementV2> = {}): Gost34RequirementV2 {
  return {
    id: 'req-1',
    code: 'ТР-ФУНК-01',
    category: 'functional',
    type: 'system',
    title: 'Требование',
    originalText: 'Система должна вести журнал событий безопасности.',
    approval: { status: 'DRAFT' },
    source: { filename: 'ТЗ_заказчика.docx', section: '4.2' },
    verificationMethod: 'TEST',
    ...overrides,
  };
}

function rules(findings: ValidationFinding[]): ValidationRuleId[] {
  return findings.map((f) => f.rule);
}

function find(
  findings: ValidationFinding[],
  rule: ValidationRuleId,
): ValidationFinding | undefined {
  return findings.find((f) => f.rule === rule);
}

describe('a well-formed requirement', () => {
  it('produces no findings', () => {
    const report = validateRequirement(makeRequirement());
    expect(report.findings).toEqual([]);
    expect(report.hasBlockingFindings).toBe(false);
    expect(report.counts).toEqual({ ERROR: 0, WARNING: 0, INFO: 0 });
  });
});

describe('atomicity', () => {
  it('flags several obligations in one requirement', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText:
          'Система должна вести журнал событий безопасности. Система должна экспортировать журнал в формате CSV.',
      }),
    );

    const finding = find(report.findings, 'atomicity');
    expect(finding?.severity).toBe('WARNING');
    expect(finding?.message).toContain('2');
  });

  it('flags enumerations inside a single requirement', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText: 'Система должна поддерживать роли: администратор; аудитор; оператор.',
      }),
    );

    expect(rules(report.findings)).toContain('atomicity');
  });
});

describe('ambiguity', () => {
  it('flags evaluative wording', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText: 'Система должна работать быстро и быть удобной для оператора.',
      }),
    );

    const finding = find(report.findings, 'ambiguity');
    expect(finding?.severity).toBe('WARNING');
    expect(finding?.message).toContain('«быстро»');
    expect(finding?.message).toContain('«удобно»');
  });

  it('leaves a numeric formulation alone', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText: 'Время отклика системы должно составлять не более 2 с.',
      }),
    );

    expect(rules(report.findings)).not.toContain('ambiguity');
  });
});

describe('measurability', () => {
  it('reports a performance requirement without a number as an error', () => {
    const report = validateRequirement(
      makeRequirement({
        category: 'performance',
        originalText: 'Система должна обеспечивать высокую пропускную способность.',
      }),
    );

    const finding = find(report.findings, 'measurability');
    expect(finding?.severity).toBe('ERROR');
    expect(report.hasBlockingFindings).toBe(true);
  });

  it('accepts a performance requirement with a measured value', () => {
    const report = validateRequirement(
      makeRequirement({
        category: 'performance',
        originalText: 'Система должна обрабатывать не менее 500 запросов в секунду.',
      }),
    );

    expect(rules(report.findings)).not.toContain('measurability');
  });

  it('demands a value once a named indicator appears in any category', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText: 'Система должна обеспечивать срок хранения журналов аудита.',
      }),
    );

    expect(find(report.findings, 'measurability')?.severity).toBe('ERROR');
  });
});

describe('testability', () => {
  it('reports the plan example: evaluative wording with no measurable indicator', () => {
    const report = validateRequirement(
      makeRequirement({
        code: 'ТР-НАД-004',
        category: 'reliability',
        originalText: 'Система должна работать быстро.',
        verificationMethod: undefined,
      }),
    );

    const finding = find(report.findings, 'testability');
    expect(finding?.severity).toBe('ERROR');
    expect(finding?.message).toContain('непроверяемо');
    expect(finding?.requirementCode).toBe('ТР-НАД-004');
  });

  it('stays silent when acceptance criteria are defined', () => {
    const report = validateRequirement(
      makeRequirement({
        verificationMethod: undefined,
        acceptanceCriteria: ['Журнал содержит запись о каждой попытке входа'],
      }),
    );

    expect(rules(report.findings)).not.toContain('testability');
  });

  it('downgrades to INFO when the value is measured but the method is missing', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText: 'Система должна хранить журналы не менее 3 лет.',
        verificationMethod: undefined,
      }),
    );

    expect(find(report.findings, 'testability')?.severity).toBe('INFO');
  });
});

describe('completeness', () => {
  it('rejects text without an obligation', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText: 'Журнал событий безопасности ведётся в системе.',
      }),
    );

    expect(find(report.findings, 'completeness')?.severity).toBe('ERROR');
  });

  it('rejects an empty text', () => {
    const report = validateRequirement(makeRequirement({ originalText: '   ' }));
    const finding = find(report.findings, 'completeness');

    expect(finding?.severity).toBe('ERROR');
    expect(finding?.message).toContain('пуст');
  });

  it('warns when the subject is missing', () => {
    const report = validateRequirement(
      makeRequirement({
        originalText: 'Должна вестись регистрация событий безопасности.',
      }),
    );

    const finding = find(report.findings, 'completeness');
    expect(finding?.severity).toBe('WARNING');
    expect(finding?.message).toContain('субъект');
  });

  it('rejects a requirement without a code', () => {
    const report = validateRequirement(makeRequirement({ code: '  ' }));
    expect(find(report.findings, 'completeness')?.message).toContain('обозначения');
  });
});

describe('source', () => {
  it('blocks a machine proposal without provenance', () => {
    const report = validateRequirement(
      makeRequirement({ approval: { status: 'PROPOSED' }, source: undefined }),
    );

    const finding = find(report.findings, 'source');
    expect(finding?.severity).toBe('ERROR');
    expect(report.hasBlockingFindings).toBe(true);
  });

  it('warns on a manual requirement without provenance', () => {
    const report = validateRequirement(makeRequirement({ source: undefined }));
    expect(find(report.findings, 'source')?.severity).toBe('WARNING');
  });

  it('warns when the source is only a hash', () => {
    const report = validateRequirement(makeRequirement({ source: { hash: 'abc123' } }));
    expect(find(report.findings, 'source')?.message).toContain('хэш');
  });

  it('reports library requirements as INFO and never blocks on them', () => {
    const report = validateRequirement(
      makeRequirement({
        type: 'regulatory',
        category: 'security',
        approval: { status: 'APPROVED' },
        source: undefined,
        originalText: 'Система должна обеспечивать защиту персональных данных надёжным образом.',
        verificationMethod: undefined,
      }),
    );

    expect(find(report.findings, 'source')?.severity).toBe('INFO');
    expect(report.hasBlockingFindings).toBe(false);
    expect(report.findings.every((f) => f.severity !== 'ERROR')).toBe(true);
  });
});

describe('conflict', () => {
  it('reports contradictory upper bounds for the same indicator', () => {
    const report = validateRequirements([
      makeRequirement({
        id: 'req-1',
        code: 'ТР-ПРО-01',
        category: 'performance',
        originalText: 'Время отклика системы должно составлять не более 2 с.',
      }),
      makeRequirement({
        id: 'req-2',
        code: 'ТР-ПРО-02',
        category: 'performance',
        originalText: 'Время отклика системы должно составлять не более 5 с.',
      }),
    ]);

    const finding = find(report.findings, 'conflict');
    expect(finding?.severity).toBe('ERROR');
    expect(finding?.message).toContain('ТР-ПРО-02');
    expect(finding?.relatedRequirementIds).toEqual(['req-2']);
  });

  it('leaves consistent values alone', () => {
    const report = validateRequirements([
      makeRequirement({
        id: 'req-1',
        category: 'performance',
        originalText: 'Время отклика системы должно составлять не более 2 с.',
      }),
      makeRequirement({
        id: 'req-2',
        code: 'ТР-ПРО-02',
        category: 'performance',
        originalText: 'Время отклика системы должно составлять не более 2 с при 100 пользователях.',
      }),
    ]);

    expect(rules(report.findings)).not.toContain('conflict');
  });

  it('reports a declared CONFLICTS_WITH relation', () => {
    const report = validateRequirements([
      makeRequirement({
        id: 'req-1',
        relations: [{ targetRequirementId: 'req-2', type: 'CONFLICTS_WITH' }],
      }),
      makeRequirement({ id: 'req-2', code: 'ТР-ФУНК-02' }),
    ]);

    expect(find(report.findings, 'conflict')?.message).toContain('ТР-ФУНК-02');
  });

  it('reports a mirrored pair that differs only by negation', () => {
    const report = validateRequirements([
      makeRequirement({
        id: 'req-1',
        originalText: 'Система должна хранить журналы аудита.',
      }),
      makeRequirement({
        id: 'req-2',
        code: 'ТР-ФУНК-02',
        originalText: 'Система не должна хранить журналы аудита.',
      }),
    ]);

    const finding = find(report.findings, 'conflict');
    expect(finding?.severity).toBe('ERROR');
    expect(finding?.relatedRequirementIds).toEqual(['req-2']);
  });
});

describe('report shape', () => {
  it('groups findings per requirement and keeps input order', () => {
    const report = validateRequirements([
      makeRequirement({
        id: 'req-1',
        originalText: 'Система должна работать быстро.',
      }),
      makeRequirement({ id: 'req-2', code: 'ТР-ФУНК-02', source: undefined }),
    ]);

    expect(Object.keys(report.byRequirement)).toEqual(['req-1', 'req-2']);
    expect(report.findings[0].requirementId).toBe('req-1');
    expect(report.counts.WARNING).toBeGreaterThan(0);
  });

  it('honours disabled rules', () => {
    const requirement = makeRequirement({
      originalText: 'Система должна работать быстро.',
    });

    expect(rules(validateRequirement(requirement).findings)).toContain('ambiguity');
    expect(
      rules(validateRequirement(requirement, { rules: { ambiguity: false } }).findings),
    ).not.toContain('ambiguity');
  });

  it('accepts an empty set', () => {
    const report = validateRequirements([]);
    expect(report.findings).toEqual([]);
    expect(report.hasBlockingFindings).toBe(false);
  });

  it('formats a finding as one line', () => {
    const report = validateRequirement(
      makeRequirement({
        code: 'ТР-НАД-004',
        originalText: 'Система должна работать быстро.',
      }),
    );

    expect(formatValidationFinding(report.findings[0])).toContain('ТР-НАД-004');
    expect(formatValidationFinding(report.findings[0])).toContain('Рекомендация:');
  });
});
