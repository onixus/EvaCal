import { describe, it, expect } from 'vitest';
import { INDUSTRY_PRESETS } from '../industryPresets';
import { primaryStagesFromTemplate, risksFromTemplate } from '@/lib/calc';

describe('Industry Presets Library', () => {
  it('contains valid and comprehensive industry presets for IT, IB, PAC, and Dev', () => {
    expect(INDUSTRY_PRESETS.length).toBeGreaterThanOrEqual(4);

    const categories = INDUSTRY_PRESETS.map((p) => p.category);
    expect(categories).toContain('security');
    expect(categories).toContain('hardware_pac');
    expect(categories).toContain('compliance');
    expect(categories).toContain('development');
  });

  it('validates that all stage driver keys reference existing fields in the preset', () => {
    for (const preset of INDUSTRY_PRESETS) {
      const fieldKeys = new Set(preset.fields.map((f) => f.key));

      for (const stage of preset.stageTemplates) {
        if (stage.driverFieldKey) {
          expect(
            fieldKeys.has(stage.driverFieldKey),
            `Stage "${stage.name}" in preset "${preset.name}" references missing field "${stage.driverFieldKey}"`,
          ).toBe(true);
        }
      }
    }
  });

  it('correctly calculates labor hours for NGFW / SZI preset', () => {
    const ngfwPreset = INDUSTRY_PRESETS.find((p) => p.id === 'preset-ngfw-szi')!;
    expect(ngfwPreset).toBeDefined();

    const answers = {
      ngfw_clusters_count: 2,
      endpoints_count: 100,
      storage_audits_count: 3,
      vpn_tunnels_count: 4,
      complexity: 'Средний',
    };

    const stages = primaryStagesFromTemplate(ngfwPreset.stageTemplates, answers);
    expect(stages).toHaveLength(ngfwPreset.stageTemplates.length);

    // Stage 0: Обследование (base 24 + 2 * 2 = 28h)
    expect(stages[0].hours).toBe(28);

    // Stage 1: Поставка лицензий (base 12 + 0.1 * 100 = 22h)
    expect(stages[1].hours).toBe(22);

    // Stage 2: Монтаж и кластеризация NGFW (base 20 + 16 * 2 = 52h)
    expect(stages[2].hours).toBe(52);

    // Stage 3: Настройка защиты рабочих станций (base 16 + 0.2 * 100 = 36h)
    expect(stages[3].hours).toBe(36);

    // Stage 4: Настройка туннелей ViPNet (base 12 + 6 * 4 = 36h)
    expect(stages[4].hours).toBe(36);

    // Stage 5: ОРД и ПМИ (base 24 + 4 * 3 = 36h)
    expect(stages[5].hours).toBe(36);

    const totalHours = stages.reduce((sum, s) => sum + s.hours, 0);
    expect(totalHours).toBe(210);
  });

  it('correctly calculates labor hours for Hardware PAC & Postgres Pro preset', () => {
    const pacPreset = INDUSTRY_PRESETS.find((p) => p.id === 'preset-hardware-pac-db')!;
    expect(pacPreset).toBeDefined();

    const answers = {
      servers_count: 4,
      racks_count: 2,
      db_clusters_count: 2,
      datacenter_count: 1,
      complexity: 'Высокий',
    };

    const stages = primaryStagesFromTemplate(pacPreset.stageTemplates, answers);
    expect(stages).toHaveLength(pacPreset.stageTemplates.length);

    // Stage 0: Технический проект (base 32 + 4 * 4 = 48h)
    expect(stages[0].hours).toBe(48);

    // Stage 1: Поставка серверов (base 16 + 2 * 4 = 24h)
    expect(stages[1].hours).toBe(24);

    // Stage 2: Монтаж в стойки (base 20 + 8 * 2 = 36h)
    expect(stages[2].hours).toBe(36);

    // Stage 3: Astra Linux SE (base 16 + 3 * 4 = 28h)
    expect(stages[3].hours).toBe(28);

    // Stage 4: СУБД Postgres Pro кластер (base 24 + 18 * 2 = 60h)
    expect(stages[4].hours).toBe(60);

    // Stage 5: Бэкап и ПМИ (base 20 + 6 * 1 = 26h)
    expect(stages[5].hours).toBe(26);

    const totalHours = stages.reduce((sum, s) => sum + s.hours, 0);
    expect(totalHours).toBe(222);
  });

  it('preserves risk template integrity', () => {
    for (const preset of INDUSTRY_PRESETS) {
      const risks = risksFromTemplate(preset.riskTemplates);
      expect(risks.length).toBeGreaterThan(0);
      for (const r of risks) {
        expect(r.hours).toBeGreaterThan(0);
        expect(r.description.length).toBeGreaterThan(10);
      }
    }
  });
});
