/**
 * Правка ответов опросника (PUT /api/calculations/:id) пересчитывает этапы
 * шаблона, а этапы из наборов решений (#103 WP-7b) переносит как есть — после
 * этапов шаблона, со своими часами, id строки и происхождением.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ locked: false, readUnderLock: false }));
vi.mock('@/lib/prisma', () => {
  const prisma: Record<string, unknown> = {
    calculation: { findUnique: vi.fn(), update: vi.fn() },
    stage: { findMany: vi.fn() },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});
vi.mock('@/lib/actualsLedgerData', () => ({
  lockCalculationLedger: vi.fn(async () => {
    state.locked = true;
  }),
}));
vi.mock('@/lib/access', () => ({
  requireCalcAccess: vi.fn(async () => ({ kind: 'staff', actorId: 'architect' })),
  requireStaff: vi.fn(async () => ({ userId: 'architect' })),
}));
vi.mock('@/lib/audit', () => ({
  actorTypeFromAccess: () => 'user',
  clientIp: () => null,
  writeAudit: vi.fn(),
}));
vi.mock('@/lib/calc', () => ({
  primaryStagesFromTemplate: () => [{ name: 'Обследование', role: 'analyst', hours: 10 }],
  rebuildStages: vi.fn(),
  rebuildStagesTx: vi.fn(),
  pmHoursFor: () => 0,
  scheduleConfigFromTemplate: () => ({}),
}));

import { prisma } from '@/lib/prisma';
import { rebuildStagesTx } from '@/lib/calc';
import { PUT } from '@/app/api/calculations/[id]/route';

const row = (over: Record<string, unknown>) => ({
  hours: 1,
  isApprovalTask: false,
  requirements: null,
  parallel: false,
  approvalDays: null,
  originRef: null,
  ...over,
});

describe('PUT расчёта переносит этапы из наборов', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      id: 'calc',
      status: 'draft',
      answers: '{}',
      startDate: new Date('2026-03-02'),
      pricingMode: 'legacy_markup',
      marginPercent: 20,
      template: { stageTemplates: [], fields: [], defaultStartDate: null },
    } as never);
    state.locked = false;
    state.readUnderLock = false;
    vi.mocked(prisma.stage.findMany).mockImplementation((async () => {
      state.readUnderLock = state.locked;
      return [
        row({ id: 's-tpl', name: 'Обследование', role: 'analyst', hours: 8 }),
        row({
          id: 's-kit',
          name: 'Монтаж',
          role: 'engineer',
          hours: 20,
          originRef: 'kit:k1@2#stage-01',
        }),
        row({
          id: 's-appr',
          name: 'Согласование',
          role: 'customer',
          hours: 0,
          isApprovalTask: true,
        }),
      ];
    }) as never);
    vi.mocked(prisma.calculation.update).mockResolvedValue({ id: 'calc' } as never);
  });

  it('этапы шаблона — по формуле, этап набора — после них с originRef', async () => {
    const res = await PUT(
      new NextRequest('http://localhost/api/calculations/calc', {
        method: 'PUT',
        body: JSON.stringify({ answers: { sites: 3 } }),
      }),
      { params: Promise.resolve({ id: 'calc' }) },
    );
    expect(res.status).toBe(200);
    expect(state.readUnderLock).toBe(true); // этапы прочитаны под блокировкой расчёта
    const primary = vi.mocked(rebuildStagesTx).mock.calls[0][2];
    expect(
      primary.map((p) => [p.name, p.hours, p.originRef ?? null, p.sourceStageId ?? null]),
    ).toEqual([
      ['Обследование', 10, null, null],
      ['Монтаж', 20, 'kit:k1@2#stage-01', 's-kit'],
    ]);
  });
});
