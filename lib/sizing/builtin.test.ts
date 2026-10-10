import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_SIZING_PROFILES } from './builtin';
import { parseRules } from './engine';

const sql = readFileSync(
  path.join(__dirname, '../../prisma/migrations/20261030100000_sizing/migration.sql'),
  'utf8',
);

describe('seeded sizing profiles', () => {
  it('migration seeds exactly the builtin approved v1 profiles', () => {
    const rows = [
      ...sql.matchAll(
        /VALUES \('sizing-(\w+)-v1', 'sizing-profile-\w+', 1,\s+'((?:[^']|'')*)'::jsonb,\s+'((?:[^']|'')*)'::jsonb,\s+'((?:[^']|'')*)', 'approved'/g,
      ),
    ].map((m) => ({
      key: m[1],
      rules: JSON.parse(m[2].replace(/''/g, "'")),
      assumptions: JSON.parse(m[3].replace(/''/g, "'")),
      source: m[4].replace(/''/g, "'"),
    }));
    expect(rows.map((r) => r.key)).toEqual(BUILTIN_SIZING_PROFILES.map((p) => p.key));
    for (const profile of BUILTIN_SIZING_PROFILES) {
      const row = rows.find((r) => r.key === profile.key)!;
      expect(row.rules).toEqual(profile.rules);
      expect(row.assumptions).toEqual(profile.assumptions);
      expect(row.source).toBe(profile.source);
      expect(() => parseRules(row.rules)).not.toThrow();
    }
  });
  it('migration keeps enums as TEXT + CHECK and guards immutability in the database', () => {
    expect(sql).toContain('"SizingProfileVersion_status_check"');
    expect(sql).toContain('"SizingRun_source_check"');
    expect(sql).toContain('CREATE TRIGGER "SizingProfileVersion_immutable"');
    expect(sql).toContain('CREATE TRIGGER "SizingRun_append_only"');
  });
});
