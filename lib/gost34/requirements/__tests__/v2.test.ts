import { describe, it, expect } from 'vitest';
import {
  Gost34RequirementV2,
  RequirementStatus,
  getRequirementEffectiveText,
  isRequirementApproved,
} from '../v2';

function makeRequirement(overrides: Partial<Gost34RequirementV2> = {}): Gost34RequirementV2 {
  return {
    id: 'req-1',
    code: 'ТР-ФУНК-01',
    category: 'functional',
    type: 'system',
    title: 'Требование',
    originalText: '  исходный текст  ',
    approval: { status: 'DRAFT' },
    ...overrides,
  };
}

describe('getRequirementEffectiveText', () => {
  it('returns the normalized text once approved', () => {
    const req = makeRequirement({
      normalizedText: '  нормализованный текст  ',
      approval: { status: 'APPROVED' },
    });
    expect(getRequirementEffectiveText(req)).toBe('нормализованный текст');
  });

  it('falls back to the original when the approved normalized text is blank', () => {
    const req = makeRequirement({
      normalizedText: '   ',
      approval: { status: 'APPROVED' },
    });
    expect(getRequirementEffectiveText(req)).toBe('исходный текст');
  });

  it('returns the original while the requirement is not approved', () => {
    for (const status of ['DRAFT', 'PROPOSED', 'REJECTED', 'SUPERSEDED'] as RequirementStatus[]) {
      const req = makeRequirement({
        normalizedText: 'нормализованный текст',
        approval: { status },
      });
      expect(getRequirementEffectiveText(req), status).toBe('исходный текст');
    }
  });
});

describe('isRequirementApproved', () => {
  it.each([
    ['APPROVED', true],
    ['DRAFT', false],
    ['PROPOSED', false],
    ['REJECTED', false],
    ['SUPERSEDED', false],
  ] as Array<[RequirementStatus, boolean]>)('%s -> %s', (status, expected) => {
    expect(isRequirementApproved(makeRequirement({ approval: { status } }))).toBe(expected);
  });
});
