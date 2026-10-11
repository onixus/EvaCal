import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
vi.mock('@/lib/auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')),
  getSession: vi.fn(async () => null),
}));
vi.mock('@/lib/export', async () => ({
  ...(await vi.importActual<typeof import('@/lib/export')>('@/lib/export')),
  loadCalculationForExport: vi.fn(),
}));
vi.mock('@/lib/specification/requirementStore', () => ({ loadRequirementOptions: vi.fn() }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { createShareToken } from '../access';
import { loadCalculationForExport, type CalculationForExport } from '../export';
import { loadRequirementOptions } from './requirementStore';
import { GET } from '@/app/api/calculations/[id]/xlsx/route';
import type { SpecificationItem } from './types';

const props = { params: Promise.resolve({ id: 'c1' }) };
const day = new Date('2026-10-01T00:00:00Z');
const row: SpecificationItem = {
  id: 'srv',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Сервер СУБД',
  vendor: 'Vendor',
  sku: 'SRV-1',
  quantity: '2',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 'КП',
  rationale: 'Сайзинг',
  confirmed: true,
  unitPrice: null,
  currency: 'RUB',
  requirementIds: ['req-db'],
};
const calc: CalculationForExport = {
  id: 'c1',
  name: 'Расчет',
  customer: 'Заказчик',
  status: 'draft',
  startDate: day,
  pmHours: 0,
  templateName: 'Шаблон',
  answers: {},
  fields: [],
  stages: [
    {
      name: 'Поставка оборудования',
      role: 'engineer',
      hours: 8,
      isApprovalTask: false,
      parallel: false,
      approvalDays: null,
      startDate: day,
      endDate: day,
      dueDate: null,
      status: 'todo',
      requirements: 'Монтаж серверов',
    },
  ],
  risks: [],
  specification: { version: 1, status: 'draft', emptySupplyReason: '', items: [row] },
};

async function matrix() {
  const share = createShareToken({ calculationId: 'c1', scopes: ['export'] });
  const res = await GET(
    new NextRequest('http://localhost/x', { headers: { 'X-Share-Token': share } }),
    props,
  );
  expect(res.status).toBe(200);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Матрица прослеживаемости'], {
    header: 1,
  });
}

describe('XLSX расчета: матрица прослеживаемости из комплекта ГОСТ 34', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'xlsx-traceability-tests-secret-32b');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(loadCalculationForExport).mockResolvedValue(calc);
  });

  it('требования комплекта и графа позиций спецификации', async () => {
    vi.mocked(loadRequirementOptions).mockResolvedValue({
      source: { kind: 'draft', packageId: 'p1', version: 1, status: 'draft' },
      requirements: [
        {
          id: 'req-db',
          code: 'ТР-БД-01',
          title: 'Серверы СУБД',
          category: 'hardware_pac',
          description: 'Два сервера СУБД.',
        },
        { id: 'req-rep', code: 'ТР-Ф-02', title: 'Отчеты', category: '', description: 'x' },
      ],
    });
    const rows = await matrix();
    expect(loadRequirementOptions).toHaveBeenCalledWith('c1');
    const header = rows.find((r) => r[0] === 'Код требования')!;
    const supply = header.indexOf('Позиции спецификации');
    expect(supply).toBeGreaterThan(0);
    const db = rows.find((r) => r[0] === 'ТР-БД-01')!;
    expect(db[supply]).toBe('Сервер СУБД (Vendor / SRV-1), 2 шт.');
    expect(rows.find((r) => r[0] === 'ТР-Ф-02')![supply]).toBe('—');
  });

  it('без комплекта — требования из этапов, графы позиций нет', async () => {
    vi.mocked(loadRequirementOptions).mockResolvedValue({ source: null, requirements: [] });
    const rows = await matrix();
    const header = rows.find((r) => r[0] === 'Код требования')!;
    expect(header).not.toContain('Позиции спецификации');
    expect(rows.some((r) => r[0] === 'ТР-ЭТ-01')).toBe(true);
  });
});
