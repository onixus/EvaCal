import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock('@/lib/sizing/store', () => ({
  listProfiles: vi.fn(),
  listRuns: vi.fn(),
  createProfileRun: vi.fn(),
  createManualRun: vi.fn(),
  createProfile: vi.fn(),
  createVersion: vi.fn(),
  setProfileArchived: vi.fn(),
  approveVersion: vi.fn(),
  archiveVersion: vi.fn(),
  loadVersion: vi.fn(),
  updateDraftVersion: vi.fn(),
}));
vi.mock('@/lib/sizing/service', () => ({
  previewSizingImpact: vi.fn(),
  applySizingImpact: vi.fn(),
  linkSizing: vi.fn(),
  proposeSizingCandidates: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { cookies } from 'next/headers';
import { createSessionToken } from '../auth';
import { createShareToken } from '../access';
import * as store from './store';
import * as service from './service';
import { SizingError } from './engine';
import * as runs from '@/app/api/calculations/[id]/sizing/route';
import * as impact from '@/app/api/calculations/[id]/sizing/impact/route';
import * as apply from '@/app/api/calculations/[id]/sizing/apply/route';
import * as link from '@/app/api/calculations/[id]/sizing/link/route';
import * as candidates from '@/app/api/calculations/[id]/sizing/candidates/route';
import * as profiles from '@/app/api/sizing/profiles/route';
import * as versions from '@/app/api/sizing/versions/[versionId]/route';

const context = { params: Promise.resolve({ id: 'calculation-1' }) };
function session(role: string) {
  const token = createSessionToken({
    id: 'actor-1',
    username: 'u',
    role,
    mustChangePassword: false,
  });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}
const req = (path: string, body?: unknown, share?: string) =>
  new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'Content-Type': 'application/json', ...(share ? { 'X-Share-Token': share } : {}) },
  });
const base = '/api/calculations/calculation-1/sizing';
const approveHash = 'a'.repeat(64);
const secretRules = {
  inputs: [{ key: 'a', label: 'A', type: 'number' }],
  derived: [{ key: 'secret_factor', formula: 'a * 1.37' }],
  outputs: [{ key: 'nodes', label: 'Узлы', kind: 'nodes', unit: 'шт.', formula: 'secret_factor' }],
  scenarios: [{ key: 'ha', label: 'HA', overrides: { a: 'a * 2' } }],
  tables: { t: { rows: [{ upTo: null, value: 1 }] } },
};

describe('calculation sizing routes follow specification access rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'sizing-route-test-secret');
    vi.stubEnv('SHARE_TOKEN_SECRET', 'sizing-share-test-secret');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(store.listProfiles).mockResolvedValue([
      {
        id: 'p',
        key: 'ngfw',
        name: 'NGFW',
        domain: 'ngfw',
        description: '',
        archived: false,
        versions: [
          { id: 'v2', status: 'draft', rules: secretRules, contentHash: approveHash },
          { id: 'v1', status: 'approved', rules: secretRules, contentHash: approveHash },
        ],
      },
    ] as never);
    vi.mocked(store.listRuns).mockResolvedValue([]);
    vi.mocked(store.createProfileRun).mockResolvedValue({ id: 'run', source: 'profile' } as never);
    vi.mocked(store.createManualRun).mockResolvedValue({ id: 'run', source: 'manual' } as never);
    vi.mocked(service.previewSizingImpact).mockResolvedValue({ rows: [] } as never);
    vi.mocked(service.applySizingImpact).mockResolvedValue({ snapshot: { version: 4 } } as never);
    vi.mocked(service.linkSizing).mockResolvedValue({ snapshot: { version: 4 } } as never);
    vi.mocked(service.proposeSizingCandidates).mockResolvedValue({ candidates: [] } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('no token: nothing is read or written', async () => {
    expect((await runs.GET(req(base), context)).status).toBe(401);
    expect((await runs.POST(req(base, {}), context)).status).toBe(401);
    expect((await impact.POST(req(`${base}/impact`, { runId: 'r' }), context)).status).toBe(401);
    expect((await apply.POST(req(`${base}/apply`, {}), context)).status).toBe(401);
    expect(service.applySizingImpact).not.toHaveBeenCalled();
  });
  it('read share: sees approved versions and previews, cannot create runs or apply', async () => {
    const share = createShareToken({ calculationId: 'calculation-1', scopes: ['read'] });
    const res = await runs.GET(req(base, undefined, share), context);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canWrite).toBe(false);
    // Guests get inputs and metric names, never formulas, derived values or tables.
    const text = JSON.stringify(data.profiles);
    expect(text).not.toContain('secret_factor');
    expect(text).not.toContain('1.37');
    expect(text).not.toContain('a * 2');
    expect(data.profiles[0].versions[0].rules.inputs[0].key).toBe('a');
    expect(data.profiles[0].versions[0].rules.outputs[0]).toMatchObject({
      key: 'nodes',
      formula: '',
    });
    expect(data.profiles[0].versions.map((v: { id: string }) => v.id)).toEqual(['v1']);
    expect((await impact.POST(req(`${base}/impact`, { runId: 'r' }, share), context)).status).toBe(
      200,
    );
    expect(service.previewSizingImpact).toHaveBeenCalledWith(
      'calculation-1',
      { runId: 'r' },
      { allowDraft: false },
    );
    expect((await runs.POST(req(base, {}, share), context)).status).toBe(403);
    expect((await apply.POST(req(`${base}/apply`, {}, share), context)).status).toBe(403);
    expect((await link.POST(req(`${base}/link`, {}, share), context)).status).toBe(403);
    expect(store.createProfileRun).not.toHaveBeenCalled();
    expect(service.applySizingImpact).not.toHaveBeenCalled();
  });
  it('write share: creates runs and applies on its own calculation only', async () => {
    const share = createShareToken({ calculationId: 'calculation-1', scopes: ['write'] });
    expect((await runs.POST(req(base, { source: 'manual' }, share), context)).status).toBe(201);
    expect(store.createManualRun).toHaveBeenCalledWith(
      'calculation-1',
      { source: 'manual' },
      'share:calculation-1',
    );
    expect((await apply.POST(req(`${base}/apply`, { runId: 'r' }, share), context)).status).toBe(
      201,
    );
    const foreign = createShareToken({ calculationId: 'other', scopes: ['write', 'read'] });
    expect((await runs.GET(req(base, undefined, foreign), context)).status).toBe(403);
    expect((await apply.POST(req(`${base}/apply`, {}, foreign), context)).status).toBe(403);
  });
  it('presale staff writes but cannot preview draft profile versions', async () => {
    session('presale');
    const data = await (await runs.GET(req(base), context)).json();
    expect(data.canWrite).toBe(true);
    // Staff sessions see full rules of approved versions.
    expect(JSON.stringify(data.profiles)).toContain('secret_factor');
    expect(data.canEditProfiles).toBe(false);
    expect(data.profiles[0].versions.map((v: { id: string }) => v.id)).toEqual(['v1']);
    await impact.POST(req(`${base}/impact`, { profileVersionId: 'v2' }), context);
    expect(service.previewSizingImpact).toHaveBeenLastCalledWith(
      'calculation-1',
      { profileVersionId: 'v2' },
      { allowDraft: false },
    );
    expect((await runs.POST(req(base, { profileVersionId: 'v1' }), context)).status).toBe(201);
  });
  it('architect previews drafts; backend errors keep their status', async () => {
    session('architect');
    const data = await (await runs.GET(req(base), context)).json();
    expect(data.profiles[0].versions).toHaveLength(2);
    await impact.POST(req(`${base}/impact`, { profileVersionId: 'v2' }), context);
    expect(service.previewSizingImpact).toHaveBeenLastCalledWith(
      'calculation-1',
      { profileVersionId: 'v2' },
      { allowDraft: true },
    );
    vi.mocked(service.applySizingImpact).mockRejectedValue(
      new SizingError('Спецификация изменена', 409),
    );
    expect((await apply.POST(req(`${base}/apply`, {}), context)).status).toBe(409);
  });
});

describe('catalog candidates for a sizing metric (#101 §5)', () => {
  const body = { runId: 'r', metric: 'eps' };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'sizing-route-test-secret');
    vi.stubEnv('SHARE_TOKEN_SECRET', 'sizing-share-test-secret');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(service.proposeSizingCandidates).mockResolvedValue({ candidates: [] } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('catalog prices are staff-only: no token 401, shares and review roles 403', async () => {
    expect((await candidates.POST(req(`${base}/candidates`, body), context)).status).toBe(401);
    const share = createShareToken({ calculationId: 'calculation-1', scopes: ['write'] });
    expect((await candidates.POST(req(`${base}/candidates`, body, share), context)).status).toBe(
      403,
    );
    session('techwriter');
    expect((await candidates.POST(req(`${base}/candidates`, body), context)).status).toBe(403);
    expect(service.proposeSizingCandidates).not.toHaveBeenCalled();
  });
  it('catalog roles get the proposal; it never writes; errors keep their status', async () => {
    session('presale');
    const res = await candidates.POST(req(`${base}/candidates`, body), context);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(service.proposeSizingCandidates).toHaveBeenCalledWith('calculation-1', body);
    vi.mocked(service.proposeSizingCandidates).mockRejectedValue(
      new SizingError('Метрика не рассчитана', 409),
    );
    expect((await candidates.POST(req(`${base}/candidates`, body), context)).status).toBe(409);
  });
});

describe('sizing profile admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'sizing-route-test-secret');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(store.listProfiles).mockResolvedValue([]);
    vi.mocked(store.createProfile).mockResolvedValue({ id: 'p', key: 'k' } as never);
    vi.mocked(store.approveVersion).mockResolvedValue({ profileKey: 'k', version: 2 } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  const vctx = { params: Promise.resolve({ versionId: 'v2' }) };
  it('requires login to read and admin/architect to change', async () => {
    expect((await profiles.GET(req('/api/sizing/profiles'))).status).toBe(401);
    session('presale');
    expect((await profiles.GET(req('/api/sizing/profiles'))).status).toBe(200);
    expect((await profiles.POST(req('/api/sizing/profiles', { key: 'k' }))).status).toBe(403);
    expect(
      (
        await versions.POST(
          req('/api/sizing/versions/v2', { action: 'approve', expectedHash: approveHash }),
          vctx,
        )
      ).status,
    ).toBe(403);
    expect(store.createProfile).not.toHaveBeenCalled();
    expect(store.approveVersion).not.toHaveBeenCalled();
    session('architect');
    expect((await profiles.POST(req('/api/sizing/profiles', { key: 'k' }))).status).toBe(201);
    expect(
      (
        await versions.POST(
          req('/api/sizing/versions/v2', { action: 'approve', expectedHash: approveHash }),
          vctx,
        )
      ).status,
    ).toBe(200);
    expect(store.approveVersion).toHaveBeenCalledWith('v2', approveHash, 'actor-1');
  });
  it('approved version edits are rejected with 409', async () => {
    session('admin');
    vi.mocked(store.updateDraftVersion).mockRejectedValue(
      new SizingError('Утвержденная версия неизменяема', 409),
    );
    const res = await versions.PATCH(
      new NextRequest('http://localhost/api/sizing/versions/v1', { method: 'PATCH', body: '{}' }),
      { params: Promise.resolve({ versionId: 'v1' }) },
    );
    expect(res.status).toBe(409);
  });
});
