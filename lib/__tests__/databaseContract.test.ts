import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const text = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

// Match actual adapter package entries, not helper packages nested beneath them.
const isAdapterPackage = (key: string) =>
  /(?:^|\/)node_modules\/@prisma\/adapter-[^/]+$/.test(key);

describe('PostgreSQL architecture contract', () => {
  it('uses one authoritative schema and only the PostgreSQL runtime adapter', () => {
    const pkg = JSON.parse(text('package.json'));
    expect(
      Object.keys(pkg.dependencies).filter((name) => name.startsWith('@prisma/adapter-')),
    ).toEqual(['@prisma/adapter-pg']);
    expect(text('prisma/schema.prisma')).toMatch(/datasource db\s*{\s*provider = "postgresql"\s*}/);
    expect(text('prisma.config.ts')).toContain("schema: 'prisma/schema.prisma'");
    expect(text('prisma.config.ts')).toContain("path: 'prisma/migrations'");
    expect(text('prisma/migrations/migration_lock.toml')).toContain('provider = "postgresql"');
    expect(pkg.scripts['db:migrate']).toBe('prisma migrate dev');
    expect(pkg.scripts['db:push']).toBeUndefined();
    const schemas = fs.readdirSync('prisma', { recursive: true })
      .filter((file) => String(file).endsWith('.prisma'));
    expect(schemas).toEqual(['schema.prisma']);
    // Upstream CLI optional peer declarations are metadata, not installed drivers.
    const lock = JSON.parse(text('package-lock.json'));
    const adapters = Object.keys(lock.packages).filter(isAdapterPackage);
    expect(adapters).toEqual(['node_modules/@prisma/adapter-pg']);
  });

  it('detects nested adapters without counting their transitive helper packages', () => {
    expect(isAdapterPackage('node_modules/@prisma/adapter-pg')).toBe(true);
    expect(isAdapterPackage('node_modules/tool/node_modules/@prisma/adapter-other')).toBe(true);
    expect(isAdapterPackage('node_modules/@prisma/adapter-pg/node_modules/@prisma/debug')).toBe(false);
    expect(isAdapterPackage('node_modules/@prisma/adapter-pg/node_modules/@prisma/driver-adapter-utils')).toBe(false);
  });

  it('preserves the checksums of already published migrations', () => {
    const expected: Record<string, string> = {
      '20260914120000_init/migration.sql':
        '37e32d5ca163b7ccf4ab58febb86183c4e9707e89173b1b18d7c52a1325e9119',
      '20260914180000_e1_deal_actuals/migration.sql':
        '7e50f28d70d30279afeccee1cc82ee5544b19bb4a0d34c3725fb7a42c1014aad',
      '20260914190000_e2_role_capacity/migration.sql':
        'ed0252fa57702d78c0b802c603dde782e2feb8e241ab25e13fb85099550e5261',
      '20260914200000_e3_deviation_reports/migration.sql':
        'da9a4841733f91d3e1ea39c72dbbfa90a2d1e423ccab9bc2a68e464807813ab0',
      '20260915010000_stage_entered_at/migration.sql':
        '0f062cd1ca5f739c6b99022da61da097d1dcd2fd5159055e325ac4572aa95697',
    };
    for (const [file, hash] of Object.entries(expected)) {
      expect(createHash('sha256').update(text(`prisma/migrations/${file}`)).digest('hex')).toBe(hash);
    }
  });
});
