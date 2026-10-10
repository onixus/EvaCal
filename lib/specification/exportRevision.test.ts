import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
vi.mock('@/lib/auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')),
  getSession: vi.fn(async () => null),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { calculation: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/specification/store', () => ({ loadSpecification: vi.fn() }));
vi.mock('@/lib/project', () => ({
  createGostPackageVersion: vi.fn(async () => ({ id: 'pkg' })),
  releaseGostPackage: vi.fn(async () => ({ id: 'pkg' })),
  getGostPackageStudioState: vi.fn(async () => ({ draft: null, latestPackage: null })),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { prisma } from '@/lib/prisma';
import { loadSpecification } from './store';
import { loadCalculationForExport } from '@/lib/export';
import { createShareToken } from '@/lib/access';
import { createGostPackageVersion, getGostPackageStudioState } from '@/lib/project';
import { POST as preview } from '@/app/api/gost34/preview/route';
import { POST as release } from '@/app/api/calculations/[id]/gost34/route';
import { GET as studio } from '@/app/api/calculations/[id]/gost34/draft/route';

const snapshot = (version: number) => ({
  version,
  status: 'confirmed' as const,
  emptySupplyReason: `NO-SUPPLY-REV-${version}`,
  items: [],
});
const saved = (version: number) => ({
  id: `s${version}`,
  snapshot: snapshot(version),
  createdAt: '2026-10-10',
  createdBy: 'review',
});
const props = { params: Promise.resolve({ id: 'calc' }) };
const request = (body?: unknown) =>
  new NextRequest('http://localhost/revision', {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Share-Token': createShareToken({ calculationId: 'calc', scopes: ['read', 'export'] }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('pinned specification export with the real calculation loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'revision-test-secret-32-bytes');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      id: 'calc',
      name: 'Review',
      customer: 'CI',
      template: { name: 'Review', fields: [] },
      answers: '{}',
      stages: [],
      risks: [],
      startDate: new Date(),
      pmHours: 0,
    } as never);
    vi.mocked(getGostPackageStudioState).mockResolvedValue({ draft: null, latestPackage: null });
    vi.mocked(loadSpecification).mockImplementation(async (_id, version) =>
      version === 999 ? null : saved(version ?? 2),
    );
  });
  afterEach(() => vi.unstubAllEnvs());
  it('rejects missing explicit revisions for preview, draft DOCX and final export', async () => {
    expect(
      (
        await preview(
          request({ calculationId: 'calc', docType: 'SPEC', specificationVersion: 999 }),
        )
      ).status,
    ).toBe(404);
    for (const draft of [true, false]) {
      expect(
        (await release(request({ docType: 'SPEC', draft, specificationVersion: 999 }), props))
          .status,
      ).toBe(404);
    }
    expect(createGostPackageVersion).not.toHaveBeenCalled();
  });
  it('keeps the selected revision after another editor saves a newer one', async () => {
    const first = await preview(
      request({ calculationId: 'calc', docType: 'SPEC', specificationVersion: 1 }),
    );
    expect(first.status).toBe(200);
    expect(JSON.stringify(await first.json())).toContain('NO-SUPPLY-REV-1');
    const result = await release(request({ docType: 'SPEC', specificationVersion: 1 }), props);
    expect(result.status).toBe(200);
    const zip = await JSZip.loadAsync(await result.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('NO-SUPPLY-REV-1');
    expect(xml).not.toContain('NO-SUPPLY-REV-2');
    expect(createGostPackageVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({ specificationVersion: 1, specification: snapshot(1) }),
      }),
    );
  });
  it('pins absent supply separately from the latest lookup', async () => {
    expect((await loadCalculationForExport('calc', null))?.specification).toBeUndefined();
    expect(loadSpecification).not.toHaveBeenCalled();
    expect((await loadCalculationForExport('calc'))?.specification?.version).toBe(2);
    vi.mocked(loadSpecification).mockClear();
    expect(
      (await release(request({ docType: 'SPEC', draft: true, specificationVersion: null }), props))
        .status,
    ).toBe(200);
    expect(loadSpecification).not.toHaveBeenCalled();
    expect(
      (await release(request({ docType: 'SPEC', specificationVersion: null }), props)).status,
    ).toBe(409);
  });
  it('initializes a new studio with one latest revision', async () => {
    expect((await (await studio(request(), props)).json()).specificationVersion).toBe(2);
  });
  it.each([1, null])(
    'restores an explicitly saved studio selection %s without advancing it',
    async (version) => {
      vi.mocked(getGostPackageStudioState).mockResolvedValue({
        draft: {
          id: 'draft',
          version: 1,
          snapshot: JSON.stringify({ specificationVersion: version }),
          updatedAt: new Date(),
        } as never,
        latestPackage: null,
      });
      expect((await (await studio(request(), props)).json()).specificationVersion).toBe(version);
      expect(loadSpecification).not.toHaveBeenCalled();
    },
  );
  it('restores legacy package snapshots using the recorded BOM version', async () => {
    vi.mocked(getGostPackageStudioState).mockResolvedValue({
      draft: {
        id: 'draft',
        version: 1,
        snapshot: JSON.stringify({ specification: snapshot(1) }),
        updatedAt: new Date(),
      } as never,
      latestPackage: null,
    });
    expect((await (await studio(request(), props)).json()).specificationVersion).toBe(1);
    expect(loadSpecification).not.toHaveBeenCalled();
  });
});
