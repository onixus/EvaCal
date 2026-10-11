import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calculation: { findUnique: vi.fn() },
    costItem: { findMany: vi.fn(async () => []) },
    specificationVersion: { findUnique: vi.fn(), findFirst: vi.fn(async () => null) },
  },
}));

import { prisma } from '@/lib/prisma';
import { loadCalculationForExport } from '@/lib/export';
import { renderCalculationXlsx } from '@/lib/xlsx';

const calc = {
  id: 'c1',
  name: 'КП',
  customer: 'Заказчик',
  status: 'draft',
  startDate: new Date('2026-11-02'),
  pmHours: 0,
  answers: '{}',
  template: { name: 'T', fields: [] },
  stages: [
    {
      name: 'Работа',
      role: 'developer',
      hours: 10,
      isApprovalTask: false,
      parallel: false,
      approvalDays: null,
      startDate: new Date('2026-11-02'),
      endDate: new Date('2026-11-06'),
      dueDate: null,
      status: 'planned',
      requirements: null,
    },
  ],
  risks: [],
  currency: 'RUB',
  roleRates: '{"developer":1000}',
  overheadPercent: 0,
  pricingMode: 'markup',
  marginPercent: 20,
  discountPercent: 0,
  vatPercent: 20,
  includeVat: true,
  pinnedSpecificationVersion: 3,
};

beforeEach(() => vi.clearAllMocks());

describe('поставка в экспорте', () => {
  it('JSON/ГОСТ-выгрузки не читают коммерческий контур', async () => {
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calc as never);
    const out = await loadCalculationForExport('c1');
    expect(out).not.toHaveProperty('supply');
    expect(prisma.costItem.findMany).not.toHaveBeenCalled();
    expect(prisma.specificationVersion.findUnique).not.toHaveBeenCalled();
  });

  it('ошибка поставки не ломает КП: маркер ошибки в выгрузке, итог по услугам', async () => {
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calc as never);
    vi.mocked(prisma.specificationVersion.findUnique).mockResolvedValue(null);
    const out = (await loadCalculationForExport('c1', undefined, { withSupply: true }))!;
    expect(out.supply).toBeNull();
    expect(out.supplyError).toContain('v3');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      XLSX.read(renderCalculationXlsx(out), { type: 'buffer' }).Sheets['Смета КП'],
      { header: 1 },
    );
    expect(rows.some((r) => r[0] === 'Поставка и статьи затрат не рассчитаны')).toBe(true);
    expect(rows.find((r) => r[0] === 'ИТОГО К ОПЛАТЕ')?.[2]).toBe(14400);
  });

  it('суммы строк поставки в XLSX округлены до 2 знаков, точные значения — в пояснении', async () => {
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calc as never);
    vi.mocked(prisma.specificationVersion.findUnique).mockResolvedValue({
      status: 'confirmed',
      data: JSON.stringify({
        version: 3,
        status: 'confirmed',
        emptySupplyReason: '',
        items: [
          {
            id: 's',
            kind: 'hardware',
            disposition: 'supply',
            name: 'Сервер',
            vendor: 'V',
            sku: 'S',
            quantity: '3',
            unit: 'шт',
            configuration: '',
            licensing: '',
            term: '',
            source: 'КП',
            rationale: 'r',
            confirmed: true,
            unitPrice: '0.333333',
            purchasePrice: '0.1',
            currency: 'RUB',
          },
        ],
      }),
    } as never);
    const out = (await loadCalculationForExport('c1', undefined, { withSupply: true }))!;
    expect(out.supply?.lines[0].sale).toBe('0.999999');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      XLSX.read(renderCalculationXlsx(out), { type: 'buffer' }).Sheets['Смета КП'],
      { header: 1 },
    );
    expect(rows.find((r) => r[0] === 'Сервер')?.[4]).toBe(1);
    expect(rows.find((r) => r[0] === 'Сервер')?.[5]).toBe(0.3);
  });
});
