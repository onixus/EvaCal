import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/access', () => ({ requireCalcAccess: vi.fn() }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(() => '127.0.0.1'),
  actorTypeFromAccess: vi.fn(() => 'user'),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { calculation: { update: vi.fn() } } }));
vi.mock('@/lib/export', async () => {
  const actual = await vi.importActual<typeof import('@/lib/export')>('@/lib/export');
  return { ...actual, loadCalculationForExport: vi.fn() };
});
vi.mock('@/lib/gost34', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gost34')>('@/lib/gost34');
  return {
    ...actual,
    generateGost34Document: vi.fn(async () => ({
      buffer: Buffer.from('docx'),
      filename: 'TZ.docx',
      ast: {},
      diagnostics: {},
    })),
  };
});
vi.mock('@/lib/project', () => ({
  createGostPackageVersion: vi.fn(async () => ({ id: 'pkg1', checksum: 'sum' })),
  releaseGostPackage: vi.fn(async () => ({ id: 'pkg1', checksum: 'sum' })),
}));

import { POST as releaseGost34 } from '@/app/api/calculations/[id]/gost34/route';
import { requireCalcAccess } from '@/lib/access';
import { loadCalculationForExport } from '@/lib/export';
import { generateGost34Document } from '@/lib/gost34';
import { createGostPackageVersion, releaseGostPackage } from '@/lib/project';

const projectContext = {
  automationObject: 'Процессы обслуживания клиентов',
  systemPurpose: 'Единое окно обслуживания',
  availability: { availabilityTargetPercent: 99.9, rtoMinutes: 15, rpoMinutes: 5 },
};

const release = (body: unknown) =>
  releaseGost34(
    new NextRequest('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'calc1' }) },
  );

describe('Выпуск комплекта учитывает проектный контекст', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCalcAccess).mockResolvedValue({
      kind: 'staff',
      actorId: 'u1',
      session: { userId: 'u1', username: 'architect', role: 'architect', exp: 0 },
    } as never);
    vi.mocked(loadCalculationForExport).mockResolvedValue({
      id: 'calc1',
      name: 'Единое окно',
      customer: 'Заказчик',
      stages: [],
      risks: [],
      answers: '{}',
    } as never);
  });

  it('передаёт контекст генератору одиночного документа', async () => {
    const res = await release({ docType: 'TZ', projectContext });

    expect(res.status).toBe(200);
    expect(vi.mocked(generateGost34Document).mock.calls[0][0]).toMatchObject({ projectContext });
  });

  it('передаёт контекст генератору каждого документа комплекта', async () => {
    const res = await release({ isBatchZip: true, projectContext });

    expect(res.status).toBe(200);
    const calls = vi.mocked(generateGost34Document).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [params] of calls) {
      expect(params).toMatchObject({ projectContext });
    }
  });

  it('сохраняет контекст в снимке выпуска — иначе выпуск невоспроизводим', async () => {
    await release({ isBatchZip: true, projectContext });
    expect(vi.mocked(releaseGostPackage).mock.calls[0][0].snapshot).toMatchObject({
      projectContext,
    });

    vi.clearAllMocks();
    vi.mocked(requireCalcAccess).mockResolvedValue({
      kind: 'staff',
      actorId: 'u1',
      session: { userId: 'u1', username: 'architect', role: 'architect', exp: 0 },
    } as never);
    vi.mocked(loadCalculationForExport).mockResolvedValue({
      id: 'calc1',
      name: 'Единое окно',
      customer: 'Заказчик',
      stages: [],
      risks: [],
      answers: '{}',
    } as never);

    await release({ docType: 'TZ', projectContext });
    expect(vi.mocked(createGostPackageVersion).mock.calls[0][0].snapshot).toMatchObject({
      projectContext,
    });
  });
});
