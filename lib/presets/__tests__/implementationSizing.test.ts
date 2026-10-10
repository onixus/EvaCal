import { describe, expect, it } from 'vitest';
import {
  buildImplementationSizing,
  detectImplementationSizingProfile,
} from '../implementationSizing';
import { fromGost34RequirementItems } from '../../gost34/requirements';
import { validateRequirements } from '../../gost34/validation';

describe('implementation sizing for SIEM / IDM / NGFW', () => {
  it('detects profiles by questionnaire keys without confusing legacy NGFW/SZI', () => {
    expect(
      detectImplementationSizingProfile({}, ['event_sources_count', 'hot_retention_days']),
    ).toBe('siem');
    expect(
      detectImplementationSizingProfile({}, ['event_sources_count', 'eps_estimate']),
    ).toBeNull();
    expect(detectImplementationSizingProfile({}, ['identities_count'])).toBe('idm');
    expect(detectImplementationSizingProfile({}, ['rules_count'])).toBe('ngfw');
    expect(
      detectImplementationSizingProfile({}, ['ngfw_clusters_count', 'endpoints_count']),
    ).toBeNull();
  });

  it('sizes SIEM throughput and storage and emits testable GOST requirements', () => {
    const sizing = buildImplementationSizing({
      event_sources_count: 160,
      eps_estimate: 10_000,
      eps_peak_factor: 2,
      avg_event_size_bytes: 1000,
      hot_retention_days: 30,
      archive_retention_days: 180,
      compression_ratio: 2,
      sites_count: 2,
      collector_ha_required: true,
      platform_ha_required: true,
      correlation_rules_count: 30,
    })!;

    expect(sizing.profile).toBe('siem');
    expect(sizing.metrics.find((m) => m.key === 'peak_eps')?.value).toBe(20_000);
    expect(Number(sizing.metrics.find((m) => m.key === 'hot_storage')?.value)).toBeGreaterThan(3);
    expect(
      sizing.gostRequirements.some((r) => r.code === 'ТР-SIEM-01' && Boolean(r.criterion)),
    ).toBe(true);
  });

  it('sizes IDM by identity and connector load', () => {
    const sizing = buildImplementationSizing({
      identities_count: 120_000,
      target_systems_count: 35,
      authoritative_sources_count: 2,
      avg_entitlements_per_identity: 10,
      jml_events_per_day: 500,
      jml_peak_factor: 4,
      idm_ha_required: true,
    })!;

    expect(sizing.profile).toBe('idm');
    expect(Number(sizing.metrics.find((m) => m.key === 'app_nodes')?.value)).toBeGreaterThanOrEqual(
      3,
    );
    expect(sizing.gostRequirements.map((r) => r.code)).toContain('ТР-IDM-01');
  });

  it('sizes NGFW target throughput with headroom', () => {
    const sizing = buildImplementationSizing({
      ngfw_clusters_count: 2,
      network_zones_count: 8,
      rules_count: 450,
      internet_throughput_gbps: 4,
      east_west_throughput_gbps: 6,
      capacity_headroom_percent: 30,
      tls_inspection_percent: 50,
      ngfw_ha_required: true,
    })!;

    expect(sizing.profile).toBe('ngfw');
    expect(sizing.metrics.find((m) => m.key === 'target_throughput')?.value).toBe(13);
    expect(sizing.metrics.find((m) => m.key === 'nodes')?.value).toBe(4);
    expect(sizing.gostRequirements.every((r) => Boolean(r.criterion))).toBe(true);
  });

  it('marks defaulted NGFW parameters as assumptions in GOST requirements', () => {
    const sizing = buildImplementationSizing({
      ngfw_clusters_count: 1,
      ngfw_ha_required: false,
      internet_throughput_gbps: 1,
    })!;

    // Пресейл-интерфейс по-прежнему считает по умолчаниям…
    expect(sizing.metrics.find((m) => m.key === 'nodes')?.value).toBe(1);
    // …но умолчания перечислены как неподтверждённые допущения.
    const keys = sizing.assumptions.map((a) => a.key);
    expect(keys).toContain('capacity_headroom_percent');
    expect(keys).toContain('availability_target_percent');
    expect(keys).toContain('east_west_throughput_gbps');
    expect(keys).not.toContain('ngfw_clusters_count');
    expect(keys).not.toContain('ngfw_ha_required');

    const ha = sizing.gostRequirements.find((r) => r.code === 'ТР-NGFW-02')!;
    expect(ha.description).toContain('всего 1 узлов');
    expect(ha.description).not.toContain('Допущения');
    expect(ha.assumptions).toContain('целевая доступность — принято «99.99» по умолчанию');
    const perf = sizing.gostRequirements.find((r) => r.code === 'ТР-NGFW-01')!;
    expect(perf.assumptions).toContain('запас производительности — принято «30» по умолчанию');
    expect(perf.assumptions).toContain('пропускная способность East-West — не задано');
  });

  it('keeps explicit zero NGFW clusters and HA default is an assumption', () => {
    const sizing = buildImplementationSizing({ ngfw_clusters_count: 0, rules_count: 10 })!;
    expect(sizing.metrics.find((m) => m.key === 'nodes')?.value).toBe(0);
    const ha = sizing.gostRequirements.find((r) => r.code === 'ТР-NGFW-02')!;
    expect(ha.assumptions).toContain('резервирование NGFW (HA) — принято «да» по умолчанию');
  });

  it('does not annotate requirements whose inputs are all answered', () => {
    const sizing = buildImplementationSizing({
      internet_throughput_gbps: 4,
      east_west_throughput_gbps: 6,
      capacity_headroom_percent: 30,
      tls_inspection_percent: 50,
    })!;
    const perf = sizing.gostRequirements.find((r) => r.code === 'ТР-NGFW-01')!;
    expect(perf.assumptions).toBeUndefined();
  });

  it('marks SIEM and IDM defaults as assumptions', () => {
    const siem = buildImplementationSizing({ event_sources_count: 10, hot_retention_days: 30 })!;
    const siemHa = siem.gostRequirements.find((r) => r.code === 'ТР-SIEM-05')!;
    expect(siemHa.assumptions).toContain('целевая доступность — принято «99.9» по умолчанию');
    expect(siem.gostRequirements.find((r) => r.code === 'ТР-SIEM-01')!.assumptions).toContain(
      'средний поток EPS — не задано',
    );

    const idm = buildImplementationSizing({ identities_count: 1000 })!;
    expect(idm.gostRequirements.find((r) => r.code === 'ТР-IDM-06')!.assumptions).toContain(
      'резервирование IDM (HA) — принято «да» по умолчанию',
    );
  });

  it('does not let assumption notes change requirement quality validation', () => {
    const sizing = buildImplementationSizing({ identities_count: 1000 })!;
    expect(sizing.gostRequirements.some((r) => r.assumptions)).toBe(true);

    const annotated = validateRequirements(fromGost34RequirementItems(sizing.gostRequirements));
    const plain = validateRequirements(
      fromGost34RequirementItems(sizing.gostRequirements.map(({ assumptions: _a, ...r }) => r)),
    );
    // Пометка о допущениях не делает требование «измеримым» и не дробит его на
    // неатомарные части: результаты проверки совпадают с исходным текстом.
    expect(annotated.counts).toEqual(plain.counts);
    // Значения совпадают с main до введения допущений (merge-base PR #111).
    expect(annotated.counts).toEqual({ ERROR: 2, WARNING: 9, INFO: 0 });
    const errorIds = annotated.findings
      .filter((f) => f.severity === 'ERROR')
      .map((f) => f.requirementId)
      .sort();
    expect(errorIds).toEqual(['preset-idm-req-ha', 'preset-idm-req-performance']);
  });

  it('reads numbers with units the same way as the GOST project context', () => {
    const sizing = buildImplementationSizing({
      internet_throughput_gbps: '10 Гбит/с',
      east_west_throughput_gbps: '5',
      capacity_headroom_percent: '30 %',
    })!;
    const keys = sizing.assumptions.map((a) => a.key);
    expect(keys).not.toContain('internet_throughput_gbps');
    expect(keys).not.toContain('capacity_headroom_percent');
    expect(sizing.metrics.find((m) => m.key === 'target_throughput')?.value).toBe(19.5);
  });
});
