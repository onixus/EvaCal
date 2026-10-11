import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')),
  getSession: vi.fn(async () => null),
}));
vi.mock('@/lib/specification/store', () => ({
  loadSpecification: vi.fn(),
  saveSpecification: vi.fn(),
}));
vi.mock('@/lib/specification/requirementStore', () => ({ loadRequirementOptions: vi.fn() }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { createShareToken, type ShareScope } from '../access';
import { saveSpecification } from './store';
import { loadRequirementOptions } from './requirementStore';
import { POST } from '@/app/api/calculations/[id]/specification/route';
import { GET as requirementsRoute } from '@/app/api/calculations/[id]/specification/requirements/route';
import type { RequirementOptions } from './requirements';

const props = { params: Promise.resolve({ id: 'c1' }) };
const token = (scopes: ShareScope[], id = 'c1') => createShareToken({ calculationId: id, scopes });
const request = (body?: unknown, share?: string) =>
  new NextRequest('http://localhost/x', {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json', ...(share ? { 'X-Share-Token': share } : {}) },
  });
const options: RequirementOptions = {
  source: { kind: 'package', packageId: 'p1', version: 3, status: 'approved' },
  requirements: [{ id: 'req-1', code: 'ТР-01', title: 'Серверы', category: '', description: '' }],
};
const row = (requirementIds?: string[]) => ({
  id: 'srv',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Сервер',
  vendor: '',
  sku: '',
  quantity: '1',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: '',
  rationale: '',
  confirmed: false,
  unitPrice: null,
  currency: 'RUB',
  ...(requirementIds ? { requirementIds } : {}),
});
const body = (requirementIds?: string[]) => ({
  version: 1,
  status: 'draft',
  emptySupplyReason: '',
  items: [row(requirementIds)],
});

describe('связи спецификации с требованиями: маршруты', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'specification-tests-secret-32bytes');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(loadRequirementOptions).mockResolvedValue(options);
    vi.mocked(saveSpecification).mockImplementation(
      async (_id, input) => ({ snapshot: { ...(input as object), version: 2 } }) as never,
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it('неизвестное требование не блокирует сохранение и дает предупреждение', async () => {
    const res = await POST(request(body(['req-1', 'gone']), token(['write'])), props);
    expect(res.status).toBe(201);
    expect(loadRequirementOptions).toHaveBeenCalledWith('c1');
    expect(saveSpecification).toHaveBeenCalledWith('c1', body(['req-1', 'gone']), 'share:c1', {
      allowNewCatalogOrigins: false,
      requirements: options,
    });
    const data = await res.json();
    expect(data.warnings).toHaveLength(1);
    expect(data.warnings[0]).toContain('gone');
    expect(data.warnings[0]).toContain('комплект v3');
  });

  it('без связей комплект не загружается, предупреждений нет', async () => {
    const res = await POST(request(body(), token(['write'])), props);
    expect(res.status).toBe(201);
    expect(loadRequirementOptions).not.toHaveBeenCalled();
    expect((await res.json()).warnings).toEqual([]);
  });

  it('список требований: чтение по share, без токена — 401', async () => {
    const ok = await requirementsRoute(request(undefined, token(['read'])), props);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(options);
    expect((await requirementsRoute(request(), props)).status).toBe(401);
    expect(
      (await requirementsRoute(request(undefined, token(['read'], 'other')), props)).status,
    ).toBe(403);
  });
});
