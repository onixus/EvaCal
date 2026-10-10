import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock('@/lib/catalog/import-profiles', () => ({
  listImportProfiles: vi.fn(),
  mutateImportProfile: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import { writeAudit } from '@/lib/audit';
import { listImportProfiles, mutateImportProfile } from './import-profiles';
import { GET, POST } from '@/app/api/catalog/imports/profiles/route';
function session(role: string, mustChangePassword = false) {
  const token = createSessionToken({ id: 'actor-1', username: 'user', role, mustChangePassword });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}
const url = 'http://localhost/api/catalog/imports/profiles';
const post = (body: string) => new NextRequest(url, { method: 'POST', body });
async function statuses() {
  const read = new NextRequest(`${url}?vendorId=v`);
  read.headers.set('X-Share-Token', 'calculation-share-token');
  const write = post('{"action":"create","name":"A","importId":"b"}');
  write.headers.set('X-Share-Token', 'calculation-share-token');
  return [(await GET(read)).status, (await POST(write)).status];
}
describe('GPL import profile access boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'catalog-import-profile-route-secret');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(listImportProfiles).mockResolvedValue([]);
    vi.mocked(mutateImportProfile).mockResolvedValue({ id: 'prof-1' } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('anonymous and share-token requests cannot list or save profiles', async () => {
    expect(await statuses()).toEqual([401, 401]);
    expect(listImportProfiles).not.toHaveBeenCalled();
    expect(mutateImportProfile).not.toHaveBeenCalled();
  });
  it.each(['reviewer', 'gap', 'techwriter'])('role %s is forbidden', async (role) => {
    session(role);
    expect(await statuses()).toEqual([403, 403]);
    expect(mutateImportProfile).not.toHaveBeenCalled();
  });
  it('mandatory password change blocks profile operations', async () => {
    session('admin', true);
    expect(await statuses()).toEqual([403, 403]);
  });
  it.each(['admin', 'architect', 'presale'])(
    'role %s saves with the authenticated actor and audit',
    async (role) => {
      session(role);
      expect((await GET(new NextRequest(`${url}?vendorId=v`))).status).toBe(200);
      expect(listImportProfiles).toHaveBeenCalledWith('v');
      const body = { action: 'create', name: 'A', importId: 'b', actorId: 'forged' };
      const response = await POST(post(JSON.stringify(body)));
      expect(response.status).toBe(201);
      expect(mutateImportProfile).toHaveBeenCalledWith(body, 'actor-1');
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          action: 'catalog.importProfile.create',
          entityId: 'prof-1',
        }),
      );
    },
  );
  it('malformed JSON is a 400 without mutation', async () => {
    session('admin');
    expect((await POST(post('{'))).status).toBe(400);
    expect(mutateImportProfile).not.toHaveBeenCalled();
  });
});
