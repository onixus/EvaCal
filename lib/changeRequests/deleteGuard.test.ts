import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calculation: { delete: vi.fn() },
    gostPackage: { findMany: vi.fn() },
    changeRequest: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/access', () => ({
  requireCalcAccess: vi.fn(),
  requireStaff: vi.fn(async () => ({ userId: 'architect', role: 'architect' })),
}));
vi.mock('@/lib/audit', () => ({
  actorTypeFromAccess: () => 'user',
  clientIp: () => null,
  writeAudit: vi.fn(),
}));
import { prisma } from '@/lib/prisma';
import { DELETE } from '@/app/api/calculations/[id]/route';

const params = { params: Promise.resolve({ id: 'calc' }) };
const del = () => DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), params);

describe('удаление расчёта, связанного с запросом на изменение (#103 WP-2b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.gostPackage.findMany).mockResolvedValue([{ id: 'pkg' }] as never);
  });

  it('база или результат запроса (в том числе через комплект) — 409, удаления нет', async () => {
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([
      { seq: 3, projectId: 'p' },
    ] as never);
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('ЗИ-03');
    expect(prisma.calculation.delete).not.toHaveBeenCalled();
    const where = vi.mocked(prisma.changeRequest.findMany).mock.calls[0][0]?.where;
    // Держат базу только поданные, отложенные и принятые запросы.
    expect(where?.status).toEqual({ in: ['submitted', 'deferred', 'accepted'] });
    expect(where?.OR).toEqual([
      { baseCalculationId: 'calc' },
      { resultCalculationId: 'calc' },
      { basePackageId: { in: ['pkg'] } },
      { resultPackageId: { in: ['pkg'] } },
    ]);
  });

  it('отказ триггера БД (гонка с подачей запроса) — 409, а не 500', async () => {
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.calculation.delete).mockRejectedValue(
      Object.assign(new Error('Calculation c is referenced by a change request'), {
        code: 'P2010',
        meta: { code: '23001' },
      }) as never,
    );
    const res = await del();
    expect(res.status).toBe(409);
  });

  it('другие ошибки удаления не маскируются под 409', async () => {
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.calculation.delete).mockRejectedValue(new Error('connection lost') as never);
    await expect(del()).rejects.toThrow('connection lost');
  });

  it('без ссылок удаляется как раньше', async () => {
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.calculation.delete).mockResolvedValue({} as never);
    expect((await del()).status).toBe(200);
    expect(prisma.calculation.delete).toHaveBeenCalledWith({ where: { id: 'calc' } });
  });
});
