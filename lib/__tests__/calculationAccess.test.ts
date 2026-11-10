import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listCalculations, POST as createCalculation } from '@/app/api/calculations/route';
import { GET as getCalculation, PUT as updateCalculation } from '@/app/api/calculations/[id]/route';

vi.mock('@/lib/access', () => ({
  requireInternalRole: vi.fn(),
  requireCalcAccess: vi.fn(),
  requireStaff: vi.fn(),
  createShareToken: vi.fn(() => 'share-token'),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(() => '127.0.0.1'),
  actorTypeFromAccess: vi.fn(() => 'user'),
}));

vi.mock('@/lib/project', () => ({
  getOrCreateProject: vi.fn(async () => ({ id: 'prj1' })),
}));

vi.mock('@/lib/calc', () => ({
  primaryStagesFromTemplate: vi.fn(() => []),
  rebuildStages: vi.fn(),
  pmHoursFor: vi.fn(() => 0),
  scheduleConfigFromTemplate: vi.fn(async () => ({})),
  risksFromTemplate: vi.fn(() => []),
}));

vi.mock('@/lib/actualsLedgerData', () => ({
  lockCalculationLedger: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calculation: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'calc_new' })),
      update: vi.fn(),
    },
    formTemplate: { findUnique: vi.fn() },
    risk: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireCalcAccess, requireInternalRole } from '@/lib/access';
import { prisma } from '@/lib/prisma';

const session = (role: string, username = role) => ({
  userId: 'u1',
  username,
  role,
  exp: Date.now() + 10_000,
});

const staffAccess = (role: string, username = role) => ({
  kind: 'staff' as const,
  actorId: 'u1',
  session: session(role, username),
});

describe('Изоляция коммерческого архива', () => {
  beforeEach(() => vi.clearAllMocks());

  it('пресейл видит только расчёты со своим логином в createdBy', async () => {
    vi.mocked(requireInternalRole).mockResolvedValue(session('presale', 'ivanov'));

    const res = await listCalculations(new NextRequest('http://localhost/api/calculations'));

    expect(res.status).toBe(200);
    expect(prisma.calculation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdBy: 'ivanov' } }),
    );
  });

  it('тех.писатель, ГАП и рецензент коммерческий список не получают', async () => {
    for (const role of ['techwriter', 'gap', 'reviewer']) {
      vi.mocked(requireInternalRole).mockResolvedValue(session(role));
      const res = await listCalculations(new NextRequest('http://localhost/api/calculations'));
      expect(res.status).toBe(403);
    }
    expect(prisma.calculation.findMany).not.toHaveBeenCalled();
  });

  it('пресейл не открывает чужой расчёт по id', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staffAccess('presale', 'ivanov') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      id: 'c1',
      createdBy: 'petrov',
      answers: '{}',
    } as never);

    const res = await getCalculation(new NextRequest('http://localhost/api/calculations/c1'), {
      params: Promise.resolve({ id: 'c1' }),
    });

    expect(res.status).toBe(403);
  });

  it('пресейл не открывает расчёт со служебной меткой createdBy', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staffAccess('presale', 'ivanov') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      id: 'c1',
      createdBy: 'presale-share',
      answers: '{}',
    } as never);

    const res = await getCalculation(new NextRequest('http://localhost/api/calculations/c1'), {
      params: Promise.resolve({ id: 'c1' }),
    });

    expect(res.status).toBe(403);
  });

  it('пресейл не правит чужой расчёт', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staffAccess('presale', 'ivanov') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      id: 'c1',
      createdBy: 'system',
      status: 'draft',
      answers: '{}',
      template: { stageTemplates: [], fields: [], defaultStartDate: null },
    } as never);

    const res = await updateCalculation(
      new NextRequest('http://localhost/api/calculations/c1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'чужое' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('Ставки ролей при создании расчёта', () => {
  const template = {
    id: 'tpl1',
    defaultStartDate: new Date('2026-01-01T00:00:00Z'),
    defaultRoleRates: JSON.stringify({ analyst: 3000 }),
    minMarginPercent: null,
    stageTemplates: [],
    fields: [],
    riskTemplates: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.formTemplate.findUnique).mockResolvedValue(template as never);
  });

  it('пресейл не подменяет ставки шаблона', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staffAccess('presale', 'ivanov') as never);

    const res = await createCalculation(
      new NextRequest('http://localhost/api/calculations', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Расчёт',
          customer: 'Банк',
          templateId: 'tpl1',
          projectId: 'prj1',
          roleRates: { analyst: 0 },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(res.status).toBe(201);
    expect(prisma.calculation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roleRates: JSON.stringify({ analyst: 3000 }),
        createdBy: 'ivanov',
      }),
    });
  });

  it('админ с некорректными ставками получает 400, расчёт не создаётся', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staffAccess('admin') as never);

    const res = await createCalculation(
      new NextRequest('http://localhost/api/calculations', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Расчёт',
          customer: 'Банк',
          templateId: 'tpl1',
          projectId: 'prj1',
          roleRates: { analyst: -1 },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(res.status).toBe(400);
    expect(prisma.calculation.create).not.toHaveBeenCalled();
  });
});
