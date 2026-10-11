import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock('@/lib/specification/evidence-refresh', () => ({
  refreshSpecificationEvidence: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(() => 'user'),
}));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import { createShareToken } from '../access';
import { writeAudit } from '../audit';
import { refreshSpecificationEvidence } from './evidence-refresh';
import { POST } from '@/app/api/calculations/[id]/specification/evidence/route';
import { SpecificationError } from './validation';

const context = { params: Promise.resolve({ id: 'calc-1' }) };
const body = { version: 3, itemIds: ['row-1'] };
const post = (value: unknown, share?: string) =>
  new NextRequest('http://localhost/api/calculations/calc-1/specification/evidence', {
    method: 'POST',
    body: typeof value === 'string' ? value : JSON.stringify(value),
    headers: { 'Content-Type': 'application/json', ...(share ? { 'X-Share-Token': share } : {}) },
  });
function session(role: string) {
  const token = createSessionToken({ id: 'actor-1', username: 'user', role });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}

describe('«Обновить сведения реестров»: права и аудит', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'evidence-route-secret');
    vi.stubEnv('SHARE_TOKEN_SECRET', 'evidence-share-secret');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(refreshSpecificationEvidence).mockResolvedValue({
      id: 'v4',
      snapshot: { version: 4, status: 'draft', items: [], emptySupplyReason: '' },
      createdAt: 'now',
      createdBy: 'actor-1',
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('без доступа и с share-токеном на чтение — отказ', async () => {
    expect((await POST(post(body), context)).status).toBe(401);
    const read = createShareToken({ calculationId: 'calc-1', scopes: ['read'] });
    expect((await POST(post(body, read), context)).status).toBe(403);
    expect(refreshSpecificationEvidence).not.toHaveBeenCalled();
  });
  it('автор спецификации обновляет сведения в расчете маршрута с аудитом', async () => {
    session('presale');
    const injected = { ...body, calculationId: 'foreign', evidence: [{ id: 'forged' }] };
    expect((await POST(post(injected), context)).status).toBe(201);
    expect(refreshSpecificationEvidence).toHaveBeenCalledWith('calc-1', injected, 'actor-1', {
      allowNewCatalogOrigins: true,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'specification.evidence.refresh', entityId: 'calc-1' }),
    );
  });
  it('устаревшая версия и битый JSON сохраняют статус', async () => {
    session('architect');
    expect((await POST(post('{'), context)).status).toBe(400);
    vi.mocked(refreshSpecificationEvidence).mockRejectedValue(
      new SpecificationError('Спецификация изменена', 409),
    );
    expect((await POST(post(body), context)).status).toBe(409);
  });
});
