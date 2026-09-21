import { describe, expect, it } from 'vitest';
import { analyzeAndNormalizeInput } from '../analyzer';
import { buildPMI34Sections } from '../templates/pmi34';

describe('presale sizing -> GOST 34 requirements and PMI', () => {
  it('adds testable SIEM sizing requirements to TZ/PMI', () => {
    const payload = analyzeAndNormalizeInput({
      calculation: {
        name: 'SIEM предприятия',
        customer: 'Заказчик',
        template: { name: 'Внедрение SIEM и мониторинга ИБ (SOC / ГосСОПКА)' },
        answers: {
          event_sources_count: 100,
          eps_estimate: 5000,
          eps_peak_factor: 2,
          avg_event_size_bytes: 800,
          hot_retention_days: 30,
          archive_retention_days: 180,
          compression_ratio: 2,
          correlation_rules_count: 20,
          sites_count: 2,
        },
        stages: [],
      },
    });

    const requirement = payload.requirementsV2?.find((item) => item.code === 'ТР-SIEM-01');
    expect(requirement).toBeDefined();
    expect(requirement?.acceptanceCriteria?.length).toBeGreaterThan(0);

    const pmi = buildPMI34Sections(payload);
    const rows = pmi.find((section) => section.id === 'sec-3')?.tables?.[0]?.rows ?? [];
    const siemRow = rows.find((row) => row[1] === 'ТР-SIEM-01');
    expect(siemRow).toBeDefined();
    expect(String(siemRow?.[3])).toContain('Проверка приема, нормализации и обработки событий SIEM');
  });

  it.each([
    [
      'Внедрение IDM / IGA и управление жизненным циклом доступа',
      {
        identities_count: 10000,
        target_systems_count: 10,
        authoritative_sources_count: 1,
        business_roles_count: 20,
        avg_entitlements_per_identity: 8,
        jml_events_per_day: 100,
      },
      'ТР-IDM-01',
    ],
    [
      'Внедрение NGFW и сегментация сетевого периметра',
      {
        ngfw_clusters_count: 2,
        network_zones_count: 8,
        rules_count: 200,
        integrations_count: 4,
        internet_throughput_gbps: 2,
        east_west_throughput_gbps: 3,
        capacity_headroom_percent: 30,
      },
      'ТР-NGFW-01',
    ],
  ])('adds sizing requirement for %s', (templateName, answers, code) => {
    const payload = analyzeAndNormalizeInput({
      calculation: {
        name: templateName,
        customer: 'Заказчик',
        template: { name: templateName },
        answers,
        stages: [],
      },
    });

    const requirement = payload.requirementsV2?.find((item) => item.code === code);
    expect(requirement).toBeDefined();
    expect(requirement?.acceptanceCriteria?.length).toBeGreaterThan(0);
  });
});
