import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock('@/lib/catalog/import-store', () => ({
  listImports: vi.fn(),
  createImport: vi.fn(),
  loadImport: vi.fn(),
  mutateImport: vi.fn(),
  importAttachment: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import {
  listImports,
  createImport,
  loadImport,
  mutateImport,
  importAttachment,
} from './import-store';
import { GET as list, POST as upload } from '@/app/api/catalog/imports/route';
import { GET as detail, POST as mutate } from '@/app/api/catalog/imports/[id]/route';
import { GET as attachment } from '@/app/api/catalog/imports/[id]/attachment/route';
const params = { params: Promise.resolve({ id: 'batch-1' }) };
function session(role: string, mustChangePassword = false) {
  const token = createSessionToken({ id: 'actor-1', username: 'user', role, mustChangePassword });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}
const request = (body = '{}') =>
  new NextRequest('http://localhost/api/catalog/imports/batch-1', { method: 'POST', body });
async function statuses() {
  const req = request();
  req.headers.set('X-Share-Token', 'calculation-share-token');
  return Promise.all([
    list(new NextRequest('http://localhost/api/catalog/imports')),
    upload(req),
    detail(req, params),
    mutate(req, params),
    attachment(req, params),
  ]).then((responses) => responses.map((response) => response.status));
}
describe('GPL import access boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'catalog-import-route-secret');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(listImports).mockResolvedValue([] as never);
    vi.mocked(loadImport).mockResolvedValue({ id: 'batch-1' } as never);
    vi.mocked(mutateImport).mockResolvedValue({ id: 'batch-1' } as never);
    vi.mocked(createImport).mockResolvedValue({ id: 'batch-1' } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('anonymous and calculation share token cannot access any import surface', async () => {
    expect(await statuses()).toEqual([401, 401, 401, 401, 401]);
    for (const fn of [listImports, createImport, loadImport, mutateImport, importAttachment]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
  it.each(['reviewer', 'gap', 'techwriter'])(
    'role %s cannot read, apply or download global GPL',
    async (role) => {
      session(role);
      expect(await statuses()).toEqual([403, 403, 403, 403, 403]);
      for (const fn of [listImports, createImport, loadImport, mutateImport, importAttachment]) {
        expect(fn).not.toHaveBeenCalled();
      }
    },
  );
  it('mandatory password change blocks all import operations', async () => {
    session('admin', true);
    expect(await statuses()).toEqual([403, 403, 403, 403, 403]);
    expect(mutateImport).not.toHaveBeenCalled();
  });
  it.each(['admin', 'architect', 'presale'])(
    'role %s applies with authenticated actor identity',
    async (role) => {
      session(role);
      expect((await list(new NextRequest('http://localhost/api/catalog/imports'))).status).toBe(
        200,
      );
      expect((await detail(request(), params)).status).toBe(200);
      const body = { action: 'confirm', revision: 1, rowIds: ['CSV:2'], actorId: 'forged' };
      const response = await mutate(request(JSON.stringify(body)), params);
      expect(response.status).toBeLessThan(300);
      expect(mutateImport).toHaveBeenCalledWith('batch-1', body, 'actor-1');
    },
  );
  it('attachment preserves original bytes with download and privacy headers', async () => {
    session('architect');
    const original = new Uint8Array([0x50, 0x4b, 0, 1]);
    vi.mocked(importAttachment).mockResolvedValue({
      file: original,
      filename: 'GPL "vendor".xlsx',
      checksum: 'abc123',
    } as never);
    const response = await attachment(request(), params);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('content-disposition')).not.toContain('\r');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-content-sha256')).toBe('abc123');
  });
  it('oversized declared upload is rejected before multipart parsing', async () => {
    session('admin');
    const req = request();
    req.headers.set('content-length', '9999999');
    expect((await upload(req)).status).toBe(413);
    expect(createImport).not.toHaveBeenCalled();
  });
  it('multipart upload uses authenticated actor and source bytes', async () => {
    session('presale');
    const form = new FormData();
    form.set('file', new File(['name;sku;price\nServer;S1;0'], 'GPL.csv', { type: 'text/csv' }));
    form.set('profile', JSON.stringify({ vendorId: 'vendor-1' }));
    const req = new NextRequest('http://localhost/api/catalog/imports', {
      method: 'POST',
      body: form,
    });
    expect((await upload(req)).status).toBe(201);
    expect(createImport).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'GPL.csv',
      { vendorId: 'vendor-1' },
      'actor-1',
    );
  });
  it('historical revision reads retain global catalog authorization', async () => {
    const req = new NextRequest('http://localhost/api/catalog/imports/batch-1?revision=2');
    req.headers.set('X-Share-Token', 'calculation-share-token');
    expect((await detail(req, params)).status).toBe(401);
    expect(loadImport).not.toHaveBeenCalled();
    session('architect');
    expect((await detail(req, params)).status).toBe(200);
    expect(loadImport).toHaveBeenCalledWith('batch-1', 2);
  });
  it.each(['0', '-1', '1.5', 'no', '9007199254740992'])(
    'invalid historical revision %s is rejected without loading',
    async (value) => {
      session('admin');
      const req = new NextRequest(`http://localhost/api/catalog/imports/batch-1?revision=${value}`);
      expect((await detail(req, params)).status).toBe(400);
      expect(loadImport).not.toHaveBeenCalled();
    },
  );
  it('malformed mutation JSON returns 400 without touching batch', async () => {
    session('admin');
    expect((await mutate(request('{'), params)).status).toBe(400);
    expect(mutateImport).not.toHaveBeenCalled();
  });
});
