import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => {
  const prisma = {
    calculation: { findUnique: vi.fn(), update: vi.fn() },
    gostPackage: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    specificationVersion: { findFirst: vi.fn(), updateMany: vi.fn() },
    // Номер версии комплекта берётся под advisory-блокировкой проекта.
    $executeRaw: vi.fn(),
    // A failing callback rejects the whole transaction, as Prisma does.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});
vi.mock('@/lib/gost34/storage', () => ({
  storePackageArtifact: vi.fn(async () => ({ artifactPath: 'p/pkg.zip', checksum: 'sha' })),
}));
import { prisma } from '@/lib/prisma';
import { createGostPackageVersion, releaseGostPackage } from '@/lib/project';
import { loadSpecification, releasedSpecificationVersion, saveSpecification } from './store';
import { parseSpecification, specificationBlockers } from './validation';
import type { SpecificationSnapshot } from './types';

const confirmed: SpecificationSnapshot = {
  version: 3,
  status: 'confirmed',
  emptySupplyReason: 'Поставка не требуется',
  items: [],
};
const pkgInput = {
  calculationId: 'c1',
  standardProfileId: 'p',
  standardProfileVersion: '1',
  generatorVersion: '1',
  documentTypes: ['spec'],
  releaseSpecification: true,
};

describe('Жизненный цикл редакции спецификации', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      id: 'c1',
      projectId: 'prj',
      name: 'n',
      customer: 'c',
      createdBy: 'u',
    } as never);
    vi.mocked(prisma.gostPackage.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.gostPackage.create).mockResolvedValue({ id: 'pkg' } as never);
    vi.mocked(prisma.gostPackage.update).mockResolvedValue({ id: 'pkg' } as never);
    vi.mocked(prisma.specificationVersion.updateMany).mockResolvedValue({ count: 1 });
  });

  it('принимает четыре статуса и старые снимки draft/confirmed', () => {
    for (const status of ['draft', 'review', 'confirmed', 'released'] as const)
      expect(parseSpecification({ ...confirmed, status }).status).toBe(status);
    expect(() => parseSpecification({ ...confirmed, status: 'approved' })).toThrow(/статус/);
  });
  it('финальный SPEC допускает только подтвержденную или выпущенную редакцию', () => {
    expect(specificationBlockers({ ...confirmed, status: 'released' })).toEqual([]);
    expect(specificationBlockers(confirmed)).toEqual([]);
    expect(specificationBlockers({ ...confirmed, status: 'review' })).toContain(
      'Версия спецификации не подтверждена.',
    );
  });
  it('редактор не может сохранить статус «выпущена»', async () => {
    await expect(
      saveSpecification('c1', { ...confirmed, status: 'released' }, 'u'),
    ).rejects.toThrow(/выпуске комплекта/);
  });
  it('статус выпуска хранится в строке редакции, данные снимка не меняются', async () => {
    vi.mocked(prisma.specificationVersion.findFirst).mockResolvedValue({
      id: 's3',
      status: 'released',
      data: JSON.stringify(confirmed),
      createdAt: new Date('2026-10-10'),
      createdBy: 'u',
    } as never);
    expect((await loadSpecification('c1', 3))?.snapshot.status).toBe('released');
  });
  it('выпуск ZIP помечает закрепленную подтвержденную редакцию выпущенной', async () => {
    await releaseGostPackage({
      ...pkgInput,
      snapshot: { specificationVersion: 3, specification: confirmed },
      zipBuffer: Buffer.from('zip'),
    });
    expect(prisma.specificationVersion.updateMany).toHaveBeenCalledWith({
      where: { calculationId: 'c1', version: 3, status: 'confirmed' },
      data: { status: 'released' },
    });
  });
  it('выпуск DOCX помечает редакцию; черновик пакета и неподтвержденная редакция — нет', async () => {
    await createGostPackageVersion({
      ...pkgInput,
      snapshot: { specificationVersion: 3, specification: confirmed },
      releasedAt: new Date(),
    });
    expect(prisma.specificationVersion.updateMany).toHaveBeenCalledTimes(1);
    vi.mocked(prisma.specificationVersion.updateMany).mockClear();
    await createGostPackageVersion({
      ...pkgInput,
      snapshot: { specificationVersion: 3, specification: confirmed },
    });
    await releaseGostPackage({
      ...pkgInput,
      snapshot: { specificationVersion: 4, specification: { ...confirmed, status: 'draft' } },
      zipBuffer: Buffer.from('zip'),
    });
    expect(prisma.specificationVersion.updateMany).not.toHaveBeenCalled();
  });
  it('извлекает номер редакции из снимка пакета', () => {
    expect(releasedSpecificationVersion(JSON.stringify({ specification: confirmed }))).toBe(3);
    expect(releasedSpecificationVersion({ specificationVersion: null })).toBeNull();
    expect(
      releasedSpecificationVersion({
        specificationVersion: 2,
        specification: { status: 'review' },
      }),
    ).toBeNull();
    expect(releasedSpecificationVersion('{bad')).toBeNull();
  });
  it('выпуск пакета и статус редакции записываются в одной транзакции', async () => {
    await releaseGostPackage({
      ...pkgInput,
      snapshot: { specificationVersion: 3, specification: confirmed },
      zipBuffer: Buffer.from('zip'),
    });
    // Каждая запись пакета идёт в транзакции (номер версии под блокировкой
    // проекта); отметка редакции — внутри транзакции финализации выпуска.
    const transactions = vi.mocked(prisma.$transaction).mock.calls.length;
    expect(transactions).toBeGreaterThanOrEqual(2);
    expect(prisma.specificationVersion.updateMany).toHaveBeenCalledTimes(1);
    await createGostPackageVersion({ ...pkgInput, snapshot: { specificationVersion: null } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(transactions + 1);
    expect(prisma.specificationVersion.updateMany).toHaveBeenCalledTimes(1);
  });
  it('сбой отметки отменяет выпуск: пакет удаляется, ошибка пробрасывается', async () => {
    vi.mocked(prisma.specificationVersion.updateMany).mockRejectedValueOnce(new Error('db down'));
    await expect(
      releaseGostPackage({
        ...pkgInput,
        snapshot: { specificationVersion: 3, specification: confirmed },
        zipBuffer: Buffer.from('zip'),
      }),
    ).rejects.toThrow('db down');
    expect(prisma.gostPackage.delete).toHaveBeenCalledWith({ where: { id: 'pkg' } });
    expect(prisma.gostPackage.updateMany).not.toHaveBeenCalled();
  });
  it('сбой записи пакета не помечает редакцию выпущенной', async () => {
    vi.mocked(prisma.gostPackage.create).mockRejectedValueOnce(new Error('conflict'));
    await expect(
      createGostPackageVersion({
        ...pkgInput,
        snapshot: { specificationVersion: 3, specification: confirmed },
        releasedAt: new Date(),
      }),
    ).rejects.toThrow('conflict');
    expect(prisma.specificationVersion.updateMany).not.toHaveBeenCalled();
  });
  it('пакет без SPEC (ТЗ, GET-выгрузка) не замораживает редакцию', async () => {
    const tzOnly = { ...pkgInput, documentTypes: ['tz'], releaseSpecification: false };
    await createGostPackageVersion({
      ...tzOnly,
      snapshot: { specificationVersion: 3, specification: confirmed },
      releasedAt: new Date(),
    });
    const { releaseSpecification: _omit, ...legacy } = pkgInput;
    void _omit;
    await releaseGostPackage({
      ...legacy,
      snapshot: { specificationVersion: 3, specification: confirmed },
      zipBuffer: Buffer.from('zip'),
    });
    expect(prisma.specificationVersion.updateMany).not.toHaveBeenCalled();
  });
});
