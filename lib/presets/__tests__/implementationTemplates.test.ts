import { describe, expect, it } from 'vitest';
import { INDUSTRY_PRESETS } from '../industryPresets';
import { primaryStagesFromTemplate } from '@/lib/calc';

describe('SIEM, IDM and NGFW implementation presets', () => {
  it.each([
    ['preset-siem-soc', 6],
    ['preset-idm-access-management', 6],
    ['preset-ngfw-implementation', 6],
  ])('%s is registered and has implementation stages', (id, stageCount) => {
    const preset = INDUSTRY_PRESETS.find((item) => item.id === id);
    expect(preset).toBeDefined();
    expect(preset?.stageTemplates).toHaveLength(stageCount);
    expect(preset?.riskTemplates.length).toBeGreaterThanOrEqual(3);
    expect(preset?.stageTemplates.every((stage) => Boolean(stage.requirements))).toBe(true);
  });

  it('calculates IDM labor from identities, systems and roles', () => {
    const preset = INDUSTRY_PRESETS.find((item) => item.id === 'preset-idm-access-management')!;
    const stages = primaryStagesFromTemplate(preset.stageTemplates, {
      identities_count: 1000,
      target_systems_count: 8,
      authoritative_sources_count: 2,
      business_roles_count: 20,
    });

    expect(stages).toHaveLength(6);
    expect(stages.every((stage) => stage.hours > 0)).toBe(true);
  });

  it('calculates dedicated NGFW labor from clusters, rules and integrations', () => {
    const preset = INDUSTRY_PRESETS.find((item) => item.id === 'preset-ngfw-implementation')!;
    const stages = primaryStagesFromTemplate(preset.stageTemplates, {
      ngfw_clusters_count: 2,
      network_zones_count: 8,
      rules_count: 300,
      integrations_count: 5,
    });

    expect(stages).toHaveLength(6);
    expect(stages.every((stage) => stage.hours > 0)).toBe(true);
  });
});
