import { describe, it, expect } from 'vitest';
import { analyzeAndNormalizeInput } from '../analyzer';
import { Gost34RequirementItem } from '../types';

const calculation = {
  id: 'calc-1',
  name: 'Тестовая система',
  customer: 'Заказчик',
  stages: [
    { id: 's1', order: 1, name: 'Обследование', role: 'аналитик', hours: 10, requirements: 'Собрать требования.' },
    { id: 's2', order: 2, name: 'Без требований', role: 'инженер', hours: 5 },
  ],
  risks: [],
};

const vendorRequirement: Gost34RequirementItem = {
  id: 'v1',
  code: 'ТР-БЕЗ-01',
  category: 'security',
  title: 'Журналирование',
  description: 'Система должна вести журнал.',
  sourceFile: 'vendor.docx',
};

function analyze(enrich: boolean) {
  return analyzeAndNormalizeInput({
    calculation,
    rawRequirements: [vendorRequirement],
    metadataOverride: {
      docType: 'TZ',
      enrichRequirements: enrich,
      enrichmentOptions: enrich ? { fstek_21: true, fstek_239: true } : undefined,
    },
  });
}

describe('analyzer requirement assembly', () => {
  it('produces the same legacy items the templates always received', () => {
    const { customRequirements } = analyze(false);

    expect(customRequirements).toEqual([
      {
        id: 'req-1',
        code: 'ТР-ЭТ-01',
        category: 'functional',
        title: 'Требования к этапу «Обследование»',
        description: 'Собрать требования.',
        originalText: 'Собрать требования.',
        stageName: 'Обследование',
        stageRole: 'аналитик',
      },
      { ...vendorRequirement, originalText: vendorRequirement.description },
    ]);
  });

  it('skips stages with no requirements text', () => {
    expect(analyze(false).customRequirements).toHaveLength(2);
  });

  it('exposes the same requirements in the v2 model', () => {
    const { customRequirements, requirementsV2 } = analyze(false);
    expect(requirementsV2).toHaveLength(customRequirements!.length);
    expect(requirementsV2![0].source?.section).toBe('Обследование');
    expect(requirementsV2![0].approval.status).toBe('DRAFT');
  });

  it('marks enricher output as approved regulatory content', () => {
    const { requirementsV2 } = analyze(true);
    const regulatory = requirementsV2!.filter((r) => r.type === 'regulatory');

    expect(regulatory.length).toBeGreaterThan(0);
    for (const requirement of regulatory) {
      expect(requirement.approval.status).toBe('APPROVED');
    }
  });

  it('attaches a validation report without blocking on library requirements', () => {
    const { validation } = analyze(true);

    expect(validation).toBeDefined();
    // "Собрать требования." carries no obligation wording — completeness catches it.
    expect(validation!.byRequirement['req-1'].some((f) => f.rule === 'completeness')).toBe(true);
    // Canned regulatory text is not editable here, so it may warn but never block.
    const libraryFindings = validation!.findings.filter((f) => f.requirementCode?.startsWith('ТР-БЕЗ-2'));
    expect(libraryFindings.every((f) => f.severity !== 'ERROR')).toBe(true);
  });

  it('appends enrichment after the project requirements', () => {
    const withoutEnrichment = analyze(false).customRequirements!;
    const withEnrichment = analyze(true).customRequirements!;

    expect(withEnrichment.slice(0, withoutEnrichment.length)).toEqual(withoutEnrichment);
    expect(withEnrichment.length).toBeGreaterThan(withoutEnrichment.length);
  });
});
