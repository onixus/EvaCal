import { describe, expect, it } from 'vitest';
import { evaluate, parseExpression, SizingExpressionError } from './expression';
import { evaluateRules, parseRules, SizingError } from './engine';
import { BUILTIN_SIZING_PROFILES } from './builtin';
import { buildImplementationSizing } from '../presets/implementationSizing';

const run = (src: string, vars: Record<string, number | boolean | null> = {}) =>
  evaluate(parseExpression(src), {
    tables: {
      tier: {
        rows: [
          { upTo: 10, value: 1 },
          { upTo: 100, value: 2 },
          { upTo: null, value: 5 },
        ],
      },
    },
    resolve: (n) => (n in vars ? vars[n] : undefined),
  });
const builtin = (key: string) =>
  parseRules(BUILTIN_SIZING_PROFILES.find((p) => p.key === key)!.rules);
const metric = (result: ReturnType<typeof evaluateRules>, scenario: string, key: string) =>
  result.scenarios.find((s) => s.key === scenario)!.outputs.find((o) => o.key === key)!;

describe('sizing expression language', () => {
  it('evaluates arithmetic, precedence, comparisons, ternary and functions', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('-2 + 5 % 3')).toBe(0);
    expect(run('max(1, ceil(a / 80), a > 0 ? 1 : 0)', { a: 170 })).toBe(3);
    expect(run('round(2.345, 2)')).toBe(2.35);
    expect(run('if(ha, 2, 1)', { ha: false })).toBe(1);
    expect(run("lookup('tier', 50)")).toBe(2);
    expect(run("lookup('tier', 1000)")).toBe(5);
    expect(run('a >= 2 && !b', { a: 2, b: false })).toBe(true);
  });
  it('propagates unknown values instead of treating them as zero', () => {
    expect(run('a + 1', { a: null })).toBeNull();
    expect(run('max(a, 1)', { a: null })).toBeNull();
    expect(run('a > 0 ? 1 : 0', { a: null })).toBeNull();
    // Unchosen branches do not need data.
    expect(run('ha ? 2 : x', { ha: true, x: null })).toBe(2);
    expect(run('false && x', { x: null })).toBe(false);
    expect(run('true || x', { x: null })).toBe(true);
  });
  it('rejects code injection, unknown functions and malformed formulas', () => {
    for (const bad of ['process.exit(1)', 'eval(1)', 'a; b', '1 +', "'x' + `y`", 'a[0]', '(1']) {
      expect(() => run(bad, { a: 1, b: 1 })).toThrow(SizingExpressionError);
    }
    expect(() => run('1 / 0')).toThrow(SizingExpressionError);
  });
});

describe('profile rules validation', () => {
  it('accepts every builtin profile', () => {
    for (const p of BUILTIN_SIZING_PROFILES)
      expect(parseRules(p.rules).outputs.length).toBeGreaterThan(0);
  });
  it('rejects references to undeclared names, cycles and override of non-inputs', () => {
    const base = {
      inputs: [{ key: 'a', label: 'A', type: 'number' }],
      outputs: [{ key: 'out', label: 'Out', kind: 'nodes', unit: 'шт.', formula: 'a * 2' }],
    };
    expect(parseRules(base).outputs[0].formula).toBe('a * 2');
    expect(() =>
      parseRules({ ...base, outputs: [{ ...base.outputs[0], formula: 'b * 2' }] }),
    ).toThrow(SizingError);
    // An output can only reference names declared above it: no cycles.
    expect(() =>
      parseRules({
        ...base,
        derived: [{ key: 'x', formula: 'out + 1' }],
      }),
    ).toThrow(SizingError);
    expect(() =>
      parseRules({ ...base, scenarios: [{ key: 's', label: 'S', overrides: { out: '1' } }] }),
    ).toThrow(SizingError);
    expect(() =>
      parseRules({ ...base, inputs: [{ key: 'a', label: 'A', type: 'number', default: 'x' }] }),
    ).toThrow(SizingError);
    expect(() => parseRules({ ...base, outputs: [{ ...base.outputs[0], kind: 'magic' }] })).toThrow(
      SizingError,
    );
  });
});

describe('builtin profile evaluation', () => {
  const ngfw = builtin('ngfw');
  it('HA on doubles NGFW nodes, HA off does not', () => {
    const on = evaluateRules(ngfw, { ngfw_clusters_count: 1, ngfw_ha_required: true });
    const off = evaluateRules(ngfw, { ngfw_clusters_count: 1, ngfw_ha_required: false });
    expect(metric(on, 'base', 'nodes').value).toBe(2);
    expect(metric(off, 'base', 'nodes').value).toBe(1);
    // Scenarios compute both regardless of the answer.
    expect(metric(off, 'ha', 'nodes').value).toBe(2);
    expect(metric(on, 'no_ha', 'nodes').value).toBe(1);
  });
  it('0 is a value, missing is unknown', () => {
    const zero = evaluateRules(ngfw, {
      ngfw_clusters_count: 0,
      internet_throughput_gbps: 0,
      east_west_throughput_gbps: 0,
    });
    expect(metric(zero, 'base', 'nodes').value).toBe(0);
    expect(metric(zero, 'base', 'target_throughput').value).toBe(0);
    const missing = evaluateRules(ngfw, { internet_throughput_gbps: 10 });
    const throughput = metric(missing, 'base', 'target_throughput');
    expect(throughput.value).toBeNull();
    expect(throughput.missing).toEqual(['east_west_throughput_gbps']);
    // A profile default is an assumption, never silently an answer.
    const nodes = metric(missing, 'base', 'nodes');
    expect(nodes.value).toBe(2);
    expect(nodes.assumptions).toEqual(['ngfw_clusters_count', 'ngfw_ha_required']);
    const input = missing.scenarios[0].inputs.find((i) => i.key === 'ngfw_clusters_count')!;
    expect(input).toMatchObject({ value: 1, origin: 'assumption' });
    expect(
      missing.scenarios[0].inputs.find((i) => i.key === 'tls_inspection_percent'),
    ).toMatchObject({
      value: null,
      origin: 'missing',
    });
  });
  it('clamps out-of-range values with a warning and parses textual answers', () => {
    const r = evaluateRules(ngfw, {
      tls_inspection_percent: 150,
      internet_throughput_gbps: '10 Гбит/с',
      ngfw_ha_required: 'нет',
    });
    expect(r.scenarios[0].warnings.join(' ')).toContain('вне допустимого диапазона');
    expect(r.scenarios[0].inputs.find((i) => i.key === 'tls_inspection_percent')!.value).toBe(100);
    expect(metric(r, 'base', 'tls_throughput').value).toBe(13);
    expect(metric(r, 'base', 'nodes').value).toBe(1);
  });
  it('growth scenario keeps assumption markers of its formula', () => {
    const r = evaluateRules(ngfw, {
      internet_throughput_gbps: 10,
      east_west_throughput_gbps: 10,
      capacity_headroom_percent: 0,
    });
    const growth = metric(r, 'growth', 'target_throughput');
    expect(growth.value).toBe(30);
    expect(growth.assumptions).toContain('growth_percent');
  });

  it('reproduces presale metrics when all inputs are answered', () => {
    const siemAnswers = {
      event_sources_count: 170,
      eps_estimate: 4200,
      eps_peak_factor: 3,
      avg_event_size_bytes: 900,
      hot_retention_days: 45,
      archive_retention_days: 365,
      compression_ratio: 3,
      sites_count: 2,
      collector_ha_required: true,
      platform_ha_required: false,
      correlation_rules_count: 40,
      siem_integrations_count: 3,
    };
    const idmAnswers = {
      identities_count: 120000,
      target_systems_count: 45,
      authoritative_sources_count: 2,
      avg_entitlements_per_identity: 12,
      jml_events_per_day: 1500,
      jml_peak_factor: 4,
      recertification_required: true,
      idm_ha_required: true,
    };
    const ngfwAnswers = {
      ngfw_clusters_count: 2,
      ngfw_ha_required: true,
      internet_throughput_gbps: 10,
      east_west_throughput_gbps: 20,
      capacity_headroom_percent: 25,
      tls_inspection_percent: 40,
      rules_count: 950,
      network_zones_count: 6,
    };
    const cases: Array<[string, Record<string, unknown>, Record<string, string>]> = [
      [
        'siem',
        siemAnswers,
        {
          peak_eps: 'peak_eps',
          daily_raw: 'daily_raw',
          hot_storage: 'hot_storage',
          archive_storage: 'archive_storage',
          collectors: 'collectors',
          ingest_units: 'ingest_units',
          use_cases: 'use_cases',
          integrations: 'integrations',
        },
      ],
      [
        'idm',
        idmAnswers,
        {
          app_nodes: 'app_nodes',
          connector_workers: 'connector_workers',
          connectors: 'connectors',
          peak_jml: 'peak_jml',
        },
      ],
      [
        'ngfw',
        ngfwAnswers,
        {
          nodes: 'nodes',
          target_throughput: 'target_throughput',
          tls_throughput: 'tls_throughput',
          migration_batches: 'migration_batches',
          zone_pairs: 'zone_pairs',
        },
      ],
    ];
    for (const [key, answers, map] of cases) {
      const presale = buildImplementationSizing(answers)!;
      expect(presale.profile).toBe(key);
      const profile = evaluateRules(builtin(key), answers);
      for (const [presaleKey, profileKey] of Object.entries(map)) {
        const expected = presale.metrics.find((m) => m.key === presaleKey)!.value;
        expect([key, profileKey, metric(profile, 'base', profileKey).value]).toEqual([
          key,
          profileKey,
          expected,
        ]);
      }
    }
  });
});

describe('prototype-safe names and non-finite results', () => {
  it('rejects prototype names as keys of inputs, derived values, outputs and tables', () => {
    const output = { key: 'out', label: 'Out', kind: 'nodes', unit: 'шт.', formula: '1' };
    for (const name of ['constructor', 'prototype', 'lookup']) {
      expect(() =>
        parseRules({ inputs: [{ key: name, label: 'X', type: 'text' }], outputs: [output] }),
      ).toThrow(SizingError);
      expect(() =>
        parseRules({ inputs: [], derived: [{ key: name, formula: '1' }], outputs: [output] }),
      ).toThrow(SizingError);
      expect(() =>
        parseRules({
          inputs: [],
          outputs: [{ ...output, formula: `lookup('${name}', 1)` }],
          tables: { [name]: { rows: [{ upTo: null, value: 1 }] } },
        }),
      ).toThrow(SizingError);
    }
    // A table that was never declared is not found through Object.prototype.
    expect(() =>
      parseRules({ inputs: [], outputs: [{ ...output, formula: "lookup('constructor', 1)" }] }),
    ).toThrow(SizingError);
  });
  it('unanswered inputs never resolve through Object.prototype', () => {
    // Rules bypassing validation (e.g. legacy JSON) still evaluate safely.
    const rules = {
      inputs: [
        { key: 'constructor', label: 'C', type: 'text' as const },
        { key: 'tostring', label: 'T', type: 'number' as const },
      ],
      derived: [],
      outputs: [
        { key: 'out', label: 'Out', kind: 'count' as const, unit: '', formula: 'tostring + 1' },
      ],
      scenarios: [],
      tables: {},
    };
    const r = evaluateRules(rules, {});
    expect(r.scenarios[0].inputs.map((i) => [i.key, i.value, i.origin])).toEqual([
      ['constructor', null, 'missing'],
      ['tostring', null, 'missing'],
    ]);
    expect(r.scenarios[0].outputs[0].value).toBeNull();
    expect(() =>
      evaluate(parseExpression("lookup('constructor', 1)"), { tables: {}, resolve: () => 1 }),
    ).toThrow(SizingExpressionError);
  });
  it('overflow is unknown with an explicit warning', () => {
    const rules = parseRules({
      inputs: [{ key: 'a', label: 'A', type: 'number' }],
      outputs: [{ key: 'big', label: 'Big', kind: 'count', unit: '', formula: 'a * 1e308 * 10' }],
      scenarios: [{ key: 'x', label: 'X', overrides: { a: 'a * 1e308 * 1e308' } }],
    });
    const r = evaluateRules(rules, { a: 10 });
    expect(r.scenarios[0].outputs[0].value).toBeNull();
    expect(r.scenarios[0].warnings.join(' ')).toContain('не является конечным числом');
    expect(r.scenarios[1].warnings.join(' ')).toContain('x.a: результат не является конечным');
  });
});
