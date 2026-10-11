import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock('@/lib/catalog/suggestions', () => ({
  createSuggestion: vi.fn(),
  listSuggestions: vi.fn(),
  reviewSuggestion: vi.fn(),
}));
vi.mock('@/lib/specification/replacements', () => ({
  previewReplacements: vi.fn(),
  applyReplacement: vi.fn(),
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
import { createSuggestion, listSuggestions, reviewSuggestion } from './suggestions';
import { applyReplacement, previewReplacements } from '../specification/replacements';
import { GET, POST } from '@/app/api/catalog/suggestions/route';
import {
  GET as replacementsGET,
  POST as replacementsPOST,
} from '@/app/api/calculations/[id]/specification/replacements/route';
import { SpecificationError } from '../specification/validation';

function session(role: string) {
  const token = createSessionToken({ id: 'actor-1', username: 'user', role });
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as never);
}
const post = (body: unknown, share?: string, url = 'http://localhost/api/catalog/suggestions') =>
  new NextRequest(url, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(share ? { 'X-Share-Token': share } : {}) },
  });
const create = { action: 'create', calculationId: 'calc-1', version: 2, itemId: 'row-1' };

describe('Предложения в каталог: права', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'suggestion-test-secret');
    vi.stubEnv('SHARE_TOKEN_SECRET', 'suggestion-share-secret');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(createSuggestion).mockResolvedValue({ id: 's1', specificationVersion: 2 } as never);
    vi.mocked(listSuggestions).mockResolvedValue([]);
    vi.mocked(reviewSuggestion).mockResolvedValue({
      id: 's1',
      createdProductId: 'p1',
      offerId: null,
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('очередь читают только роли каталога', async () => {
    const get = () => GET(new NextRequest('http://localhost/api/catalog/suggestions'));
    expect((await get()).status).toBe(401);
    session('reviewer');
    expect((await get()).status).toBe(403);
    session('presale');
    expect((await get()).status).toBe(200);
  });
  it('автор спецификации (write) предлагает строку; аудит фиксирует актора', async () => {
    session('architect');
    expect((await POST(post(create))).status).toBe(201);
    expect(createSuggestion).toHaveBeenCalledWith('calc-1', create, 'actor-1');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'catalog.suggestion.create', entityId: 's1' }),
    );
  });
  it('share-токен с write своего расчета может предложить, read — нет', async () => {
    const write = createShareToken({ calculationId: 'calc-1', scopes: ['write'] });
    expect((await POST(post(create, write))).status).toBe(201);
    const read = createShareToken({ calculationId: 'calc-1', scopes: ['read'] });
    expect((await POST(post(create, read))).status).toBe(403);
  });
  it('принять/отклонить могут только роли каталога', async () => {
    const accept = { action: 'accept', id: 's1', product: {} };
    const write = createShareToken({ calculationId: 'calc-1', scopes: ['write'] });
    expect((await POST(post(accept, write))).status).toBe(401);
    session('reviewer');
    expect((await POST(post({ action: 'reject', id: 's1', comment: 'нет' }))).status).toBe(403);
    expect(reviewSuggestion).not.toHaveBeenCalled();
    session('admin');
    expect((await POST(post(accept))).status).toBe(201);
    expect(reviewSuggestion).toHaveBeenCalledWith(accept, 'actor-1');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'catalog.suggestion.accept' }),
    );
  });
  it('неизвестное действие и битый JSON — 400; конфликт сохраняет статус', async () => {
    session('admin');
    expect((await POST(post({ action: 'drop' }))).status).toBe(400);
    expect((await POST(post('{'))).status).toBe(400);
    vi.mocked(reviewSuggestion).mockRejectedValue(new SpecificationError('Уже рассмотрено', 409));
    expect((await POST(post({ action: 'reject', id: 's1', comment: 'x' }))).status).toBe(409);
  });
});

describe('Замена позиции в проекте: права', () => {
  const context = { params: Promise.resolve({ id: 'calc-1' }) };
  const url = 'http://localhost/api/calculations/calc-1/specification/replacements';
  const body = { version: 3, itemId: 'row-1', relationId: 'r1', offerId: null };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'suggestion-test-secret');
    vi.stubEnv('SHARE_TOKEN_SECRET', 'suggestion-share-secret');
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(previewReplacements).mockResolvedValue({ version: 3, candidates: [] });
    vi.mocked(applyReplacement).mockResolvedValue({
      id: 'v4',
      snapshot: { version: 4, status: 'draft', items: [], emptySupplyReason: '' },
      createdAt: 'now',
      createdBy: 'actor-1',
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('share-токен и роли без каталога не заменяют', async () => {
    const write = createShareToken({ calculationId: 'calc-1', scopes: ['write', 'read'] });
    expect((await replacementsPOST(post(body, write, url), context)).status).toBe(401);
    session('reviewer');
    expect((await replacementsGET(new NextRequest(url), context)).status).toBe(403);
    expect(applyReplacement).not.toHaveBeenCalled();
  });
  it('роль каталога заменяет в расчете из маршрута с аудитом', async () => {
    session('presale');
    expect((await replacementsGET(new NextRequest(url), context)).status).toBe(200);
    const injected = { ...body, calculationId: 'foreign' };
    expect((await replacementsPOST(post(injected, undefined, url), context)).status).toBe(201);
    expect(applyReplacement).toHaveBeenCalledWith('calc-1', injected, 'actor-1');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'specification.catalog.replace', entityId: 'calc-1' }),
    );
    vi.mocked(applyReplacement).mockRejectedValue(new SpecificationError('Изменена', 409));
    expect((await replacementsPOST(post(body, undefined, url), context)).status).toBe(409);
  });
});
