import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock('@/lib/specification/gpl-updates', () => ({
  previewGplUpdate: vi.fn(),
  applyGplUpdate: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import { createShareToken } from '../access';
import { previewGplUpdate, applyGplUpdate } from './gpl-updates';
import { GET, POST } from '@/app/api/calculations/[id]/specification/gpl/route';
import { SpecificationError } from './validation';
const context = { params: Promise.resolve({ id: 'calculation-1' }) };
function session(role: string, mustChangePassword = false) {
  const token = createSessionToken({ id: 'actor-1', username: 'user', role, mustChangePassword });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}
const body = {
  action: 'apply',
  version: 3,
  targetImportId: 'new-gpl',
  targetRevision: 2,
  targetChecksum: 'abc',
  selections: [{ itemId: 'item-1', fields: ['unitPrice'] }],
};
const request = (value?: unknown, share?: string) =>
  new NextRequest(
    'http://localhost/api/calculations/calculation-1/specification/gpl?targetImportId=new-gpl',
    {
      method: value === undefined ? 'GET' : 'POST',
      ...(value === undefined
        ? {}
        : { body: typeof value === 'string' ? value : JSON.stringify(value) }),
      headers: { 'Content-Type': 'application/json', ...(share ? { 'X-Share-Token': share } : {}) },
    },
  );
async function denied(status: number, share?: string) {
  expect((await GET(request(undefined, share), context)).status).toBe(status);
  expect((await POST(request(body, share), context)).status).toBe(status);
  expect(previewGplUpdate).not.toHaveBeenCalled();
  expect(applyGplUpdate).not.toHaveBeenCalled();
}
describe('GPL project update staff authorization and calculation contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'gpl-project-route-test-secret');
    vi.stubEnv('SHARE_TOKEN_SECRET', 'gpl-project-share-test-secret');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(previewGplUpdate).mockResolvedValue({
      version: 3,
      rows: [],
      totals: { before: [], after: [] },
      warnings: [],
    } as never);
    vi.mocked(applyGplUpdate).mockResolvedValue({
      id: 'spec-4',
      snapshot: { version: 4, status: 'draft', items: [] },
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('no session cannot expose or apply global GPL proposal', async () => {
    await denied(401);
  });
  it('anonymous presale mode does not open global GPL sources', async () => {
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'true');
    await denied(401);
  });
  it.each(['calculation-1', 'foreign-calculation'])(
    'write share for %s cannot enter global GPL paths',
    async (calculationId) => {
      const token = createShareToken({ calculationId, scopes: ['write', 'read', 'export'] });
      await denied(401, token);
    },
  );
  it.each(['reviewer', 'gap', 'techwriter', 'guest'])(
    'role %s cannot obtain catalog proposals',
    async (role) => {
      session(role);
      await denied(403);
    },
  );
  it('required password change blocks both paths before source lookup', async () => {
    session('admin', true);
    await denied(403);
  });
  it.each(['admin', 'architect', 'presale'])(
    'role %s uses route calculation and authenticated actor',
    async (role) => {
      session(role);
      expect((await GET(request(), context)).status).toBe(200);
      expect(previewGplUpdate).toHaveBeenCalledWith('calculation-1', 'new-gpl');
      const injected = {
        ...body,
        calculationId: 'foreign-calculation',
        actorId: 'forged',
        proposal: { unitPrice: '0' },
      };
      const response = await POST(request(injected), context);
      expect(response.status).toBeLessThan(300);
      expect(applyGplUpdate).toHaveBeenCalledWith('calculation-1', injected, 'actor-1');
    },
  );
  it('malformed JSON cannot bypass authentication or reach apply', async () => {
    expect((await POST(request('{'), context)).status).toBe(401);
    session('admin');
    expect((await POST(request('{'), context)).status).toBe(400);
    expect(applyGplUpdate).not.toHaveBeenCalled();
  });
  it('stale version and missing source errors retain backend rejection status', async () => {
    session('architect');
    vi.mocked(applyGplUpdate).mockRejectedValue(
      new SpecificationError('Спецификация уже изменена', 409),
    );
    expect((await POST(request(body), context)).status).toBe(409);
    vi.mocked(previewGplUpdate).mockRejectedValue(new SpecificationError('GPL не найден', 404));
    expect((await GET(request(), context)).status).toBe(404);
  });
});
