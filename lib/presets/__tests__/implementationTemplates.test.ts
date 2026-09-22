import { describe, expect, it } from 'vitest';
import { INDUSTRY_PRESETS } from '../industryPresets';
import { primaryStagesFromTemplate } from '@/lib/calc';

describe('SIEM, IDM and NGFW implementation presets', () => {
  it.each([
    ['preset-siem-soc', 8, 24],
    ['preset-idm-access-management', 8, 24],
    ['preset-ngfw-implementation', 8, 25],
  ])('%s is a full presale questionnaire', (id, stageCount, fieldCount) => {
    const preset = INDUSTRY_PRESETS.find((item) => item.id === id);
    expect(preset).toBeDefined();
    // Нижняя граница, а не точное число: к каждому пресету при сборке
    // библиотеки добавляются общие поля ГОСТ 34 (см. withCommonGostFields).
    // Тест сторожит, что опросник не усох, а не его точный состав.
    expect(preset?.fields.length).toBeGreaterThanOrEqual(fieldCount);
    expect(preset?.stageTemplates).toHaveLength(stageCount);
    expect(preset?.riskTemplates.length).toBeGreaterThanOrEqual(5);
    expect(preset?.stageTemplates.every((stage) => Boolean(stage.requirements))).toBe(true);
  });

  it('calculates IDM labor from identities, systems, roles and workflows', () => {
    const preset = INDUSTRY_PRESETS.find((item) => item.id === 'preset-idm-access-management')!;
    const stages = primaryStagesFromTemplate(preset.stageTemplates, {
      identities_count: 1000,
      target_systems_count: 8,
      authoritative_sources_count: 2,
      business_roles_count: 20,
      approval_workflows_count: 6,
    });

    expect(stages).toHaveLength(8);
    expect(stages.every((stage) => stage.hours > 0)).toBe(true);
  });

  it('calculates dedicated NGFW labor from clusters, rules, integrations and VPN', () => {
    const preset = INDUSTRY_PRESETS.find((item) => item.id === 'preset-ngfw-implementation')!;
    const stages = primaryStagesFromTemplate(preset.stageTemplates, {
      ngfw_clusters_count: 2,
      network_zones_count: 8,
      rules_count: 300,
      integrations_count: 5,
      site_to_site_vpn_count: 4,
      critical_services_count: 10,
    });

    expect(stages).toHaveLength(8);
    expect(stages.every((stage) => stage.hours > 0)).toBe(true);
  });
});
