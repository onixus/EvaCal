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
vi.mock('@/lib/export', async () => ({
  ...(await vi.importActual<typeof import('@/lib/export')>('@/lib/export')),
  loadCalculationForExport: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { calculation: { update: vi.fn() } } }));
vi.mock('@/lib/project', () => ({
  createGostPackageVersion: vi.fn(async () => ({ id: 'p1' })),
  releaseGostPackage: vi.fn(async () => ({ id: 'p1', checksum: 'abc' })),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { createShareToken } from '../access';
import { loadSpecification, saveSpecification } from './store';
import { GET, POST } from '@/app/api/calculations/[id]/specification/route';
import { POST as exportDoc } from '@/app/api/calculations/[id]/gost34/route';
import { POST as previewDoc } from '@/app/api/gost34/preview/route';
import { loadCalculationForExport } from '../export';
import { createGostPackageVersion } from '../project';
import type { ShareScope } from '../access';

const props = { params: Promise.resolve({ id: 'c1' }) };
const token = (scopes: ShareScope[], id = 'c1') => createShareToken({ calculationId: id, scopes });
const request = (body?: unknown, share?: string, url = 'http://localhost/x') =>
  new NextRequest(url, {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json', ...(share ? { 'X-Share-Token': share } : {}) },
  });
const snapshot = {
  version: 1,
  status: 'confirmed',
  emptySupplyReason: 'Поставка не предусмотрена',
  items: [],
};

describe('Маршруты спецификации и выпуска с реальным share gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'specification-tests-secret-32bytes');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(loadSpecification).mockResolvedValue({
      id: 's1',
      snapshot,
      createdAt: '2026-10-10',
      createdBy: 'u1',
    } as never);
    vi.mocked(loadCalculationForExport).mockResolvedValue({
      name: 'Тест',
      customer: 'Тест',
      stages: [],
      risks: [],
      specification: snapshot,
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('нет токена — нет чтения, записи и экспорта', async () => {
    expect((await GET(request(), props)).status).toBe(401);
    expect((await POST(request(snapshot), props)).status).toBe(401);
    expect((await exportDoc(request({ docType: 'SPEC' }), props)).status).toBe(401);
    expect(loadSpecification).not.toHaveBeenCalled();
    expect(saveSpecification).not.toHaveBeenCalled();
  });
  it('read share читает свою версию, но не записывает и не экспортирует', async () => {
    const share = token(['read']);
    expect(
      (await GET(request(undefined, share, 'http://localhost/x?version=1'), props)).status,
    ).toBe(200);
    expect(loadSpecification).toHaveBeenCalledWith('c1', 1);
    expect((await POST(request(snapshot, share), props)).status).toBe(403);
    expect((await exportDoc(request({ docType: 'SPEC' }, share), props)).status).toBe(403);
    expect(saveSpecification).not.toHaveBeenCalled();
  });
  it('токен другого расчета не дает доступ', async () => {
    expect((await GET(request(undefined, token(['read'], 'other')), props)).status).toBe(403);
    expect(
      (await exportDoc(request({ docType: 'SPEC' }, token(['export'], 'other')), props)).status,
    ).toBe(403);
  });
  it('несуществующая историческая редакция не выглядит новой пустой спецификацией', async () => {
    vi.mocked(loadSpecification).mockResolvedValue(null);
    expect(
      (await GET(request(undefined, token(['read']), 'http://localhost/x?version=9'), props))
        .status,
    ).toBe(404);
  });
  it('write share сохраняет с аудируемым актором', async () => {
    vi.mocked(saveSpecification).mockResolvedValue({ snapshot } as never);
    expect((await POST(request(snapshot, token(['write'])), props)).status).toBe(201);
    expect(saveSpecification).toHaveBeenCalledWith('c1', snapshot, 'share:c1');
  });
  it('preview и экспорт используют запрошенную сохраненную версию, снимок записан в пакет', async () => {
    const share = token(['export']);
    expect(
      (
        await previewDoc(
          request({ calculationId: 'c1', docType: 'SPEC', specificationVersion: 1 }, share),
        )
      ).status,
    ).toBe(200);
    expect(
      (await exportDoc(request({ docType: 'SPEC', specificationVersion: 1 }, share), props)).status,
    ).toBe(200);
    expect(loadCalculationForExport).toHaveBeenCalledWith('c1', 1);
    expect(createGostPackageVersion).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ specification: snapshot }) }),
    );
  });
  it('неподтвержденная спецификация не выпускается; черновик не создает пакет', async () => {
    vi.mocked(loadCalculationForExport).mockResolvedValue({
      name: 'Тест',
      customer: 'Тест',
      stages: [],
      risks: [],
    } as never);
    const share = token(['export']);
    expect((await exportDoc(request({ docType: 'SPEC' }, share), props)).status).toBe(409);
    expect(createGostPackageVersion).not.toHaveBeenCalled();
    const draft = await exportDoc(request({ docType: 'SPEC', draft: true }, share), props);
    expect(draft.status).toBe(200);
    expect(createGostPackageVersion).not.toHaveBeenCalled();
    expect(draft.headers.get('Content-Disposition')).toContain('DRAFT_SPEC');
  });
  it.each([0, -1, '1', 1.5])('отклоняет некорректный выбор версии %j', async (version) => {
    expect(
      (
        await exportDoc(
          request({ docType: 'SPEC', specificationVersion: version }, token(['export'])),
          props,
        )
      ).status,
    ).toBe(400);
  });
});
