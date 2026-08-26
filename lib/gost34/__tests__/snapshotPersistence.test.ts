import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveGostPackageDraft,
  getGostPackageDraft,
  releaseGostPackage,
  reviewGostPackage,
} from '@/lib/project';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    calculation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    gostPackage: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../storage', () => ({
  storePackageArtifact: vi.fn(async (projectId: string, packageId: string, buffer: any) => ({
    artifactPath: `${projectId}/${packageId}.zip`,
    checksum: 'mock-sha256-checksum',
    sizeBytes: buffer.length,
  })),
}));

describe('GOST 34 Snapshot Persistence & Release Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves and reloads a draft snapshot across wizard sessions', async () => {
    const calc = {
      id: 'calc-100',
      name: 'Банковская система v1',
      customer: 'Северный Банк',
      createdBy: 'presale',
      projectId: 'prj-100',
    };
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calc as any);
    vi.mocked(prisma.gostPackage.findFirst).mockResolvedValue(null);

    const createdDraft = {
      id: 'pkg-draft-1',
      projectId: 'prj-100',
      calculationId: 'calc-100',
      name: 'Черновик комплекта ГОСТ 34 v1',
      version: 1,
      status: 'draft',
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '2020',
      generatorVersion: '0.3.0',
      documentTypes: JSON.stringify(['tz']),
      snapshot: JSON.stringify({
        contractNumber: 'Договор № 44-ФЗ/2026',
        city: 'Санкт-Петербург',
        requirements: [{ id: 'REQ-1', originalText: 'Отказоустойчивость СУБД 99.99%' }],
      }),
    };
    vi.mocked(prisma.gostPackage.create).mockResolvedValue(createdDraft as any);

    const snapshotData = {
      standardProfileId: 'ru-gost34-current',
      contractNumber: 'Договор № 44-ФЗ/2026',
      city: 'Санкт-Петербург',
      requirements: [{ id: 'REQ-1', originalText: 'Отказоустойчивость СУБД 99.99%' }],
    };

    const savedDraft = await saveGostPackageDraft({
      calculationId: 'calc-100',
      snapshot: snapshotData,
      createdBy: 'architect',
    });

    expect(savedDraft.id).toBe('pkg-draft-1');
    expect(savedDraft.status).toBe('draft');
    expect(prisma.gostPackage.create).toHaveBeenCalled();

    // Now test getGostPackageDraft
    vi.mocked(prisma.gostPackage.findFirst).mockResolvedValue(createdDraft as any);
    const loadedDraft = await getGostPackageDraft('calc-100');
    expect(loadedDraft).not.toBeNull();
    expect(loadedDraft!.id).toBe('pkg-draft-1');
    const parsedSnap = JSON.parse(loadedDraft!.snapshot!);
    expect(parsedSnap.contractNumber).toBe('Договор № 44-ФЗ/2026');
  });

  it('releases an immutable package with SHA-256 and handles review decisions', async () => {
    const calc = {
      id: 'calc-100',
      name: 'Банковская система v1',
      customer: 'Северный Банк',
      createdBy: 'presale',
      projectId: 'prj-100',
    };
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calc as any);
    vi.mocked(prisma.gostPackage.findFirst).mockResolvedValue(null);

    const createdPkg = {
      id: 'pkg-rel-1',
      projectId: 'prj-100',
      calculationId: 'calc-100',
      name: 'Комплект ГОСТ 34 v1 (TZ, PMI)',
      version: 1,
      status: 'under_review',
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '2020',
      generatorVersion: '0.3.0',
      documentTypes: JSON.stringify(['tz', 'pmi']),
      snapshot: JSON.stringify({ docType: 'ZIP' }),
      releasedAt: new Date(),
      releasedBy: 'architect-user',
    };
    vi.mocked(prisma.gostPackage.create).mockResolvedValue(createdPkg as any);
    vi.mocked(prisma.gostPackage.update).mockResolvedValue({
      ...createdPkg,
      artifactPath: 'prj-100/pkg-rel-1.zip',
      checksum: 'mock-sha256-checksum',
    } as any);

    const released = await releaseGostPackage({
      calculationId: 'calc-100',
      name: 'Комплект ГОСТ 34 v1 (TZ, PMI)',
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '2020',
      generatorVersion: '0.3.0',
      documentTypes: ['tz', 'pmi'],
      snapshot: { docType: 'ZIP' },
      zipBuffer: Buffer.from('mock-zip-bytes'),
      actorId: 'architect-user',
    });

    expect(released.id).toBe('pkg-rel-1');
    expect(released.status).toBe('under_review');
    expect(released.checksum).toBe('mock-sha256-checksum');

    // Review approve
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue({
      ...createdPkg,
      status: 'under_review',
    } as any);
    vi.mocked(prisma.gostPackage.update).mockResolvedValue({
      ...createdPkg,
      status: 'approved',
      approvedBy: 'customer-lead',
      reviewComment: 'Утверждено без замечаний',
    } as any);

    const approved = await reviewGostPackage({
      packageId: 'pkg-rel-1',
      decision: 'approve',
      actorId: 'customer-lead',
      comment: 'Утверждено без замечаний',
    });

    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('customer-lead');

    // Review immutable check: if package already approved
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue({
      ...createdPkg,
      status: 'approved',
    } as any);

    await expect(
      reviewGostPackage({
        packageId: 'pkg-rel-1',
        decision: 'reject',
        actorId: 'someone',
      }),
    ).rejects.toThrow('Утверждённый комплект документов неизменяем.');
  });
});
