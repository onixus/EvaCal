import { describe, expect, it } from 'vitest';
import {
  buildImplementationSizing,
  detectImplementationSizingProfile,
} from '../implementationSizing';

describe('implementation sizing for SIEM / IDM / NGFW', () => {
  it('detects profiles by questionnaire keys without confusing legacy NGFW/SZI', () => {
    expect(detectImplementationSizingProfile('x', {}, ['event_sources_count', 'hot_retention_days'])).toBe('siem');
    expect(detectImplementationSizingProfile('legacy SIEM', {}, ['event_sources_count', 'eps_estimate'])).toBeNull();
    expect(detectImplementationSizingProfile('x', {}, ['identities_count'])).toBe('idm');
    expect(detectImplementationSizingProfile('x', {}, ['rules_count'])).toBe('ngfw');
    expect(detectImplementationSizingProfile('legacy', {}, ['ngfw_clusters_count', 'endpoints_count'])).toBeNull();
  });

  it('sizes SIEM throughput and storage and emits testable GOST requirements', () => {
    const sizing = buildImplementationSizing('SIEM', {
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
    expect(sizing.gostRequirements.some((r) => r.code === 'ТР-SIEM-01' && Boolean(r.criterion))).toBe(true);
  });

  it('sizes IDM by identity and connector load', () => {
    const sizing = buildImplementationSizing('IDM / IGA', {
      identities_count: 120_000,
      target_systems_count: 35,
      authoritative_sources_count: 2,
      avg_entitlements_per_identity: 10,
      jml_events_per_day: 500,
      jml_peak_factor: 4,
      idm_ha_required: true,
    })!;

    expect(sizing.profile).toBe('idm');
    expect(Number(sizing.metrics.find((m) => m.key === 'app_nodes')?.value)).toBeGreaterThanOrEqual(3);
    expect(sizing.gostRequirements.map((r) => r.code)).toContain('ТР-IDM-01');
  });

  it('sizes NGFW target throughput with headroom', () => {
    const sizing = buildImplementationSizing('Внедрение NGFW', {
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
});
