import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/catalog/store', () => ({ loadCatalog: vi.fn(), mutateCatalog: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import { writeAudit } from '../audit';
import { mutateCatalog } from './store';
import { POST } from '@/app/api/catalog/route';
import { SpecificationError } from '../specification/validation';

const body = {
  action: 'evidence.create',
  productId: 'p1',
  evidence: { type: 'certificate', number: '4063' },
};
const request = (value: unknown, share?: string) =>
  new NextRequest('http://localhost/api/catalog', {
    method: 'POST',
    body: JSON.stringify(value),
    headers: share ? { 'X-Share-Token': share } : {},
  });
function session(role: string) {
  const token = createSessionToken({ id: 'u1', username: 'user', role });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}

describe('Подтверждения соответствия в каталоге: права и аудит', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'compliance-test-secret');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(mutateCatalog).mockResolvedValue({ id: 'ev-1' } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('без сессии и для ролей вне каталога запись запрещена', async () => {
    expect((await POST(request(body, 'token'))).status).toBe(401);
    for (const role of ['reviewer', 'gap', 'techwriter']) {
      session(role);
      expect((await POST(request(body))).status).toBe(403);
    }
    expect(mutateCatalog).not.toHaveBeenCalled();
  });
  it.each(['admin', 'architect', 'presale'])(
    'роль %s вносит подтверждение с аудитом',
    async (role) => {
      session(role);
      expect((await POST(request(body))).status).toBe(201);
      expect(mutateCatalog).toHaveBeenCalledWith(body, 'u1');
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'catalog.evidence.create',
          entityId: 'ev-1',
          actorId: 'u1',
        }),
      );
    },
  );
  it('ошибки проверки и конфликт редакции сохраняют статус', async () => {
    session('admin');
    vi.mocked(mutateCatalog).mockRejectedValueOnce(new SpecificationError('Ссылка', 400));
    expect((await POST(request(body))).status).toBe(400);
    vi.mocked(mutateCatalog).mockRejectedValueOnce(new SpecificationError('Изменено', 409));
    expect(
      (await POST(request({ action: 'evidence.archive', id: 'ev-1', revision: 1 }))).status,
    ).toBe(409);
  });
});
