import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/prisma', () => ({
  prisma: { calculation: { findUnique: vi.fn(), update: vi.fn() } },
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
  primaryStagesFromTemplate: () => [],
  rebuildStages: vi.fn(),
  pmHoursFor: () => 0,
  scheduleConfigFromTemplate: () => ({}),
}));
import { prisma } from '@/lib/prisma';
import { PATCH, PUT } from '@/app/api/calculations/[id]/route';

const existing = {
  id: 'calc',
  status: 'draft',
  pricingMode: 'legacy_markup',
  marginPercent: 20,
  answers: '{}',
  template: { stageTemplates: [], fields: [] },
};
const params = { params: Promise.resolve({ id: 'calc' }) };
describe('commercial API writes (#102)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(existing as never);
    vi.mocked(prisma.calculation.update).mockResolvedValue(existing as never);
  });
  for (const [method, handler] of [
    ['PUT', PUT],
    ['PATCH', PATCH],
  ] as const) {
    it(`${method} saves mode with the percentage`, async () => {
      const response = await handler(
        new NextRequest('http://localhost/api/calculations/calc', {
          method,
          body: JSON.stringify({ pricingMode: 'target_margin', marginPercent: 20 }),
        }),
        params,
      );
      expect(response.status).toBe(200);
      expect(prisma.calculation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pricingMode: 'target_margin', marginPercent: 20 }),
        }),
      );
    });
    it(`${method} rejects 100% target margin before any mutation`, async () => {
      const response = await handler(
        new NextRequest('http://localhost/api/calculations/calc', {
          method,
          body: JSON.stringify({ pricingMode: 'target_margin', marginPercent: 100 }),
        }),
        params,
      );
      expect(response.status).toBe(400);
      expect(prisma.calculation.update).not.toHaveBeenCalled();
    });
    it(`${method} leaves approved historical proposals untouched`, async () => {
      vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
        ...existing,
        status: 'approved',
      } as never);
      const response = await handler(
        new NextRequest('http://localhost/api/calculations/calc', {
          method,
          body: JSON.stringify({ pricingMode: 'target_margin' }),
        }),
        params,
      );
      expect(response.status).toBe(409);
      expect(prisma.calculation.update).not.toHaveBeenCalled();
    });
  }
});
