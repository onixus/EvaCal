import { describe, it, expect } from 'vitest';
import { INDUSTRY_PRESETS } from '../industryPresets';
import { extractRequirementsFromStages } from '@/lib/gost34/analyzerHelpers';
import { validateRequirements, formatValidationFinding } from '@/lib/gost34/validation';
import { MODAL_PATTERN } from '@/lib/gost34/validation/lexicon';

/**
 * Тексты требований к этапам попадают в ТЗ дословно (см. analyzer:
 * `includeStageRequirements` включён по умолчанию), поэтому они обязаны
 * проходить ту же валидацию, что и требования ТЗ. Замечание уровня ERROR
 * превращается в блокер выпуска комплекта и делает пресет непригодным.
 */
describe('Preset stage requirements pass GOST 34 validation', () => {
  it.each(INDUSTRY_PRESETS.map((preset) => [preset.id, preset] as const))(
    'preset %s has no ERROR-level findings in stage requirements',
    (_id, preset) => {
      const stages = preset.stageTemplates.map((stage, index) => ({
        id: `stage-${index}`,
        order: stage.order ?? index + 1,
        name: stage.name,
        role: stage.role,
        hours: 0,
        requirements: stage.requirements,
      }));

      const report = validateRequirements(extractRequirementsFromStages(stages));
      const errors = report.findings.filter((finding) => finding.severity === 'ERROR');

      expect(errors.map(formatValidationFinding).join('\n')).toBe('');
    },
  );

  it('every preset actually contributes stage requirements to the ТЗ', () => {
    for (const preset of INDUSTRY_PRESETS) {
      const withText = preset.stageTemplates.filter((stage) => stage.requirements?.trim());
      expect(withText.length, `preset ${preset.id} has no stage requirements`).toBeGreaterThan(0);
    }
  });

  it('every stage requirement is phrased as an obligation', () => {
    for (const preset of INDUSTRY_PRESETS) {
      for (const stage of preset.stageTemplates) {
        const text = stage.requirements?.trim();
        if (!text) continue;

        expect(
          MODAL_PATTERN.test(text),
          `«${stage.name}» in ${preset.id} is not phrased as a requirement: ${text}`,
        ).toBe(true);
      }
    }
  });
});
