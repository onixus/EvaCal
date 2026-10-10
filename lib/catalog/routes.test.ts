import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')),
  getSession: vi.fn(),
}));
vi.mock('@/lib/catalog/store', () => ({ loadCatalog: vi.fn(), mutateCatalog: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));
// Mock cookies used by the real requireApiRole, not the gate itself.
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import { loadCatalog, mutateCatalog } from './store';
import { GET, POST } from '@/app/api/catalog/route';
const request = (body: string = '{}') =>
  new NextRequest('http://localhost/api/catalog', { method: 'POST', body });
function session(role: string, mustChangePassword = false) {
  const token = createSessionToken({ id: 'u1', username: 'user', role, mustChangePassword });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}
describe('Границы доступа общего каталога', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'catalog-test-secret');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(loadCatalog).mockResolvedValue({ vendors: [], products: [] });
    vi.mocked(mutateCatalog).mockResolvedValue({ id: 'v' } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('гость и share-токен расчета не читают и не пишут каталог', async () => {
    expect((await GET()).status).toBe(401);
    const req = request();
    req.headers.set('X-Share-Token', 'calculation-only');
    expect((await POST(req)).status).toBe(401);
    expect(loadCatalog).not.toHaveBeenCalled();
    expect(mutateCatalog).not.toHaveBeenCalled();
  });
  it.each(['reviewer', 'gap', 'techwriter'])('роль %s не управляет каталогом', async (role) => {
    session(role);
    expect((await GET()).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(mutateCatalog).not.toHaveBeenCalled();
  });
  it.each(['admin', 'architect', 'presale'])(
    'роль %s допускается с аудируемым актором',
    async (role) => {
      session(role);
      expect((await GET()).status).toBe(200);
      expect((await POST(request('{"action":"vendor.create","name":"Vendor"}'))).status).toBe(201);
      expect(mutateCatalog).toHaveBeenCalledWith({ action: 'vendor.create', name: 'Vendor' }, 'u1');
    },
  );
  it('обязательная смена пароля блокирует каталог', async () => {
    session('admin', true);
    expect((await GET()).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
  });
  it('битый JSON дает 400 без записи', async () => {
    session('admin');
    expect((await POST(request('{'))).status).toBe(400);
    expect(mutateCatalog).not.toHaveBeenCalled();
  });
});
