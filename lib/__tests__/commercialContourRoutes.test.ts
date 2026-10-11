import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    calculation: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    costItem: { findMany: vi.fn(async () => []), create: vi.fn(), findUnique: vi.fn() },
    specificationVersion: { findUnique: vi.fn() },
    discountApproval: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    exchangeRate: { findUnique: vi.fn(), findMany: vi.fn(async () => []), create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRaw: vi.fn(async () => 1),
  };
  return { prisma };
});
vi.mock('@/lib/commercialContourData', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commercialContourData')>(
    '@/lib/commercialContourData',
  );
  return { ...actual, loadCommercialState: vi.fn() };
});

import { requireApiRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadCommercialState } from '@/lib/commercialContourData';
import { POST as approve } from '@/app/api/calculations/[id]/approve/route';
import { POST as requestDiscount } from '@/app/api/calculations/[id]/discount-approvals/route';
import { PATCH as decideDiscount } from '@/app/api/calculations/[id]/discount-approvals/[approvalId]/route';
import { POST as createCostItem } from '@/app/api/calculations/[id]/cost-items/route';
import { PATCH as pinSpec } from '@/app/api/calculations/[id]/commercial/route';
import { POST as createRate } from '@/app/api/exchange-rates/route';

const session = (role: string, username = 'ivanov') =>
  ({ userId: 'u1', username, role, exp: 0 }) as never;
const req = (body: unknown, method = 'POST') =>
  new NextRequest('http://localhost/x', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const params = { params: Promise.resolve({ id: 'c1' }) };
const approvalParams = { params: Promise.resolve({ id: 'c1', approvalId: 'a1' }) };

const FP = 'f'.repeat(64);
const state = (gate: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  ({
    calculationId: 'c1',
    status: 'draft',
    updatedAt: '2026-10-11T10:00:00.000Z',
    fingerprint: FP,
    minMarginPercent: 15,
    discountPercent: 10,
    gate: {
      state: 'below',
      requiresApproval: true,
      approved: false,
      approvalId: null,
      margin: 8.5,
      message: 'Маржа 8.5% ниже порога 15%.',
      ...gate,
    },
    ...over,
  }) as never;

const editable = { id: 'c1', status: 'draft', currency: 'RUB', discountPercent: 10 } as never;

beforeEach(() => vi.clearAllMocks());

describe('утверждение расчёта и порог маржи', () => {
  it('маржа ниже порога без согласования — 409, расчёт не утверждается', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    vi.mocked(loadCommercialState).mockResolvedValue(state({}));
    const res = await approve(req({}), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('ниже порога');
    expect(prisma.calculation.updateMany).not.toHaveBeenCalled();
  });

  it('с согласованной скидкой — утверждается под блокировкой и только при неизменной строке', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    vi.mocked(loadCommercialState).mockResolvedValue(state({ approved: true, approvalId: 'a1' }));
    vi.mocked(prisma.calculation.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({ id: 'c1' } as never);
    expect((await approve(req({}), params)).status).toBe(200);
    expect(prisma.$executeRaw).toHaveBeenCalled(); // pg_advisory_xact_lock
    expect(vi.mocked(prisma.calculation.updateMany).mock.calls[0][0].where).toEqual({
      id: 'c1',
      updatedAt: new Date('2026-10-11T10:00:00.000Z'),
    });
    expect(loadCommercialState).toHaveBeenCalledWith('c1', prisma);
  });

  it('расчёт изменился между чтением условий и записью — 409', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    vi.mocked(loadCommercialState).mockResolvedValue(state({ requiresApproval: false }));
    vi.mocked(prisma.calculation.updateMany).mockResolvedValue({ count: 0 } as never);
    const res = await approve(req({}), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('изменился');
  });
});

describe('согласование скидки', () => {
  it('заявка фиксирует скидку, маржу и порог и отзывает прежнюю ожидающую', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale'));
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(editable);
    vi.mocked(loadCommercialState).mockResolvedValue(state({}));
    vi.mocked(prisma.discountApproval.create).mockResolvedValue({ id: 'a1' } as never);
    const res = await requestDiscount(req({ comment: 'стратегический клиент' }), params);
    expect(res.status).toBe(201);
    expect(prisma.discountApproval.updateMany).toHaveBeenCalledWith({
      where: { calculationId: 'c1', status: 'pending' },
      data: { status: 'withdrawn' },
    });
    expect(vi.mocked(prisma.discountApproval.create).mock.calls[0][0].data).toMatchObject({
      requestedPercent: 10,
      resultingMargin: 8.5,
      minMarginPercent: 15,
      termsFingerprint: FP,
      requestedBy: 'ivanov',
      comment: 'стратегический клиент',
    });
  });

  it('заявка не нужна, если маржа не ниже порога', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale'));
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(editable);
    vi.mocked(loadCommercialState).mockResolvedValue(
      state({ state: 'ok', requiresApproval: false }),
    );
    expect((await requestDiscount(req({}), params)).status).toBe(409);
  });

  it('автор не согласует свою заявку; пресейл не решает; изменённые условия — 409', async () => {
    vi.mocked(prisma.discountApproval.findUnique).mockResolvedValue({
      id: 'a1',
      calculationId: 'c1',
      status: 'pending',
      requestedPercent: 10,
      resultingMargin: 8.5,
      termsFingerprint: FP,
      requestedBy: 'ivanov',
    } as never);
    vi.mocked(requireApiRole).mockResolvedValue(session('architect', 'ivanov'));
    expect(
      (await decideDiscount(req({ decision: 'approved' }, 'PATCH'), approvalParams)).status,
    ).toBe(403);
    vi.mocked(requireApiRole).mockResolvedValue(session('presale', 'petrov'));
    expect(
      (await decideDiscount(req({ decision: 'approved' }, 'PATCH'), approvalParams)).status,
    ).toBe(403);
    vi.mocked(requireApiRole).mockResolvedValue(session('architect', 'petrov'));
    // Та же маржа, но условия другие (например, изменились статьи) — отпечаток не совпал.
    vi.mocked(loadCommercialState).mockResolvedValue(state({}, { fingerprint: 'e'.repeat(64) }));
    expect(
      (await decideDiscount(req({ decision: 'approved' }, 'PATCH'), approvalParams)).status,
    ).toBe(409);
    expect(prisma.discountApproval.update).not.toHaveBeenCalled();

    vi.mocked(loadCommercialState).mockResolvedValue(state({}));
    vi.mocked(prisma.discountApproval.update).mockResolvedValue({ id: 'a1' } as never);
    expect(
      (await decideDiscount(req({ decision: 'approved' }, 'PATCH'), approvalParams)).status,
    ).toBe(200);
    expect(vi.mocked(prisma.discountApproval.update).mock.calls[0][0].data).toMatchObject({
      status: 'approved',
      decidedBy: 'petrov',
    });
  });
});

describe('статьи затрат', () => {
  it('утверждённый расчёт не меняется', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale'));
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      ...(editable as object),
      status: 'approved',
    } as never);
    expect((await createCostItem(req({}), params)).status).toBe(409);
  });

  it('денежные значения — точные десятичные строки; число или пробелы — 400', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale'));
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(editable);
    const good = {
      kind: 'travel',
      description: 'Командировка',
      quantity: '2',
      unitCost: '15000.50',
      currency: 'RUB',
    };
    for (const bad of [
      { ...good, quantity: 2 },
      { ...good, unitCost: ' 1' },
      { ...good, kind: 'food' },
    ]) {
      expect((await createCostItem(req(bad), params)).status).toBe(400);
    }
    expect(
      (
        await createCostItem(
          req({
            ...good,
            exchangeRate: '90',
            exchangeRateDate: '2026-10-01',
            exchangeRateSource: 'ЦБ',
          }),
          params,
        )
      ).status,
    ).toBe(400); // курс при той же валюте не нужен
    vi.mocked(prisma.costItem.create).mockResolvedValue({ id: 'ci' } as never);
    expect((await createCostItem(req({ ...good, unitCost: '' }), params)).status).toBe(201);
    expect(vi.mocked(prisma.costItem.create).mock.calls[0][0].data).toMatchObject({
      quantity: '2',
      unitCost: null,
      calculationId: 'c1',
    });
  });
});

describe('закрепление спецификации', () => {
  it('только подтверждённая редакция этого расчёта', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(editable);
    vi.mocked(prisma.specificationVersion.findUnique).mockResolvedValue({
      status: 'draft',
      data: '{}',
    } as never);
    expect((await pinSpec(req({ pinnedSpecificationVersion: 2 }, 'PATCH'), params)).status).toBe(
      409,
    );
    expect((await pinSpec(req({ pinnedSpecificationVersion: 0 }, 'PATCH'), params)).status).toBe(
      400,
    );
    expect(prisma.calculation.update).not.toHaveBeenCalled();
  });
});

describe('справочник курсов', () => {
  it('ревьювер не вносит курсы', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(
      NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }),
    );
    expect((await createRate(req({}))).status).toBe(403);
    expect(requireApiRole).toHaveBeenCalledWith(['architect', 'admin']);
  });

  it('курс — положительная строка до 8 знаков; запись на дату и источник не перезаписывается', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    const body = {
      from: 'usd',
      to: 'RUB',
      rate: '92.12345678',
      date: '2026-10-01',
      source: 'ЦБ РФ',
    };
    for (const bad of [
      { ...body, rate: 92.1 },
      { ...body, rate: '0' },
      { ...body, rate: '1.123456789' },
      { ...body, to: 'USD' },
      { ...body, source: '' },
    ]) {
      expect((await createRate(req(bad))).status).toBe(400);
    }
    vi.mocked(prisma.exchangeRate.findUnique).mockResolvedValue({ id: 'x' } as never);
    expect((await createRate(req(body))).status).toBe(409);
    vi.mocked(prisma.exchangeRate.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.exchangeRate.create).mockResolvedValue({
      id: 'r1',
      from: 'USD',
      to: 'RUB',
      rate: { toFixed: () => '92.12345678' },
      date: new Date('2026-10-01T00:00:00Z'),
      source: 'ЦБ РФ',
      createdBy: 'ivanov',
      createdAt: new Date(),
    } as never);
    const res = await createRate(req(body));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      from: 'USD',
      rate: '92.12345678',
      date: '2026-10-01',
    });
    expect(vi.mocked(prisma.exchangeRate.create).mock.calls[0][0].data).toMatchObject({
      from: 'USD',
      rate: '92.12345678',
    });
  });
});
