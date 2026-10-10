import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock('@/lib/catalog/import-comparison', () => ({ compareImports: vi.fn() }));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import { compareImports } from './import-comparison';
import { GET } from '@/app/api/catalog/imports/compare/route';
import { SpecificationError } from '../specification/validation';
function session(role: string, mustChangePassword = false) {
  const token = createSessionToken({ id: 'actor-1', username: 'user', role, mustChangePassword });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}
const request = (query = 'before=old-gpl&after=new-gpl') =>
  new NextRequest(`http://localhost/api/catalog/imports/compare?${query}`);
describe('GPL comparison real authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'catalog-comparison-route-secret');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(compareImports).mockResolvedValue({
      before: { id: 'old-gpl' },
      after: { id: 'new-gpl' },
      rows: [],
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('anonymous mode does not grant access to global GPL comparison', async () => {
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'true');
    expect((await GET(request())).status).toBe(401);
    expect(compareImports).not.toHaveBeenCalled();
  });
  it('calculation share token cannot grant access', async () => {
    const req = request('before=old-gpl&after=new-gpl&share=calculation-token');
    req.headers.set('X-Share-Token', 'calculation-token');
    expect((await GET(req)).status).toBe(401);
    expect(compareImports).not.toHaveBeenCalled();
  });
  it.each(['reviewer', 'gap', 'techwriter', 'guest'])(
    'role %s cannot read GPL comparison',
    async (role) => {
      session(role);
      expect((await GET(request())).status).toBe(403);
      expect(compareImports).not.toHaveBeenCalled();
    },
  );
  it('password-change requirement blocks comparison before storage access', async () => {
    session('admin', true);
    expect((await GET(request())).status).toBe(403);
    expect(compareImports).not.toHaveBeenCalled();
  });
  it.each(['admin', 'architect', 'presale'])(
    'role %s can compare selected sources with private response',
    async (role) => {
      session(role);
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(compareImports).toHaveBeenCalledExactlyOnceWith('old-gpl', 'new-gpl');
      expect(await response.json()).toMatchObject({
        before: { id: 'old-gpl' },
        after: { id: 'new-gpl' },
      });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    },
  );
  it.each([400, 404, 409])('preserves backend comparison rejection %s', async (status) => {
    session('architect');
    vi.mocked(compareImports).mockRejectedValue(
      new SpecificationError('Недопустимые источники GPL', status),
    );
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Недопустимые источники GPL' });
  });
  it('unexpected storage errors do not disclose internal details', async () => {
    session('admin');
    vi.mocked(compareImports).mockRejectedValue(new Error('Database private connection secret'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Ошибка импорта GPL' });
  });
});
