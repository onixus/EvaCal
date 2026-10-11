import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
vi.mock('@/lib/auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')),
  getSession: vi.fn(async () => null),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    calculation: { findUnique: vi.fn(), update: vi.fn() },
    // ZIP включает ПСИ и акт: факты испытаний ищутся в комплектах расчёта.
    gostPackage: { findFirst: vi.fn(async () => null) },
    costItem: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/specification/store', () => ({ loadSpecification: vi.fn() }));
vi.mock('@/lib/project', () => ({
  createGostPackageVersion: vi.fn(async () => ({ id: 'pkg' })),
  releaseGostPackage: vi.fn(async () => ({ id: 'pkg', checksum: 'abc' })),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(),
  actorTypeFromAccess: vi.fn(),
}));
import { prisma } from '@/lib/prisma';
import { loadSpecification } from './store';
import { createShareToken, type ShareScope } from '@/lib/access';
import { createGostPackageVersion, releaseGostPackage } from '@/lib/project';
import { writeAudit } from '@/lib/audit';
import { GET as xlsx } from '@/app/api/calculations/[id]/specification/xlsx/route';
import { POST as bomPreview } from '@/app/api/calculations/[id]/specification/import/route';
import { GET as download, POST as release } from '@/app/api/calculations/[id]/gost34/route';
import type { SpecificationSnapshot } from './types';

const snapshot: SpecificationSnapshot = {
  version: 2,
  status: 'confirmed',
  emptySupplyReason: '',
  items: [
    {
      id: 'a',
      kind: 'hardware',
      disposition: 'supply',
      name: 'Сервер',
      vendor: 'V',
      sku: 'S',
      quantity: '2',
      unit: 'шт.',
      configuration: '',
      licensing: '',
      term: '',
      source: 'КП',
      rationale: 'Сайзинг',
      confirmed: true,
      unitPrice: '10.5',
      currency: 'RUB',
    },
  ],
};
const props = { params: Promise.resolve({ id: 'c1' }) };
const token = (scopes: ShareScope[], id = 'c1') => createShareToken({ calculationId: id, scopes });
const get = (share?: string, query = '') =>
  new NextRequest(`http://localhost/x${query}`, {
    headers: share ? { 'X-Share-Token': share } : {},
  });

describe('XLSX редакции: права доступа как у экспорта SPEC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SESSION_SECRET', 'specification-output-secret-32b');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
    vi.mocked(loadSpecification).mockImplementation(async (_id, version) =>
      version === 9 ? null : { id: 's', snapshot, createdAt: '', createdBy: 'u' },
    );
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      id: 'c1',
      name: 'Банк',
      customer: 'CI',
      template: { name: 'T', fields: [] },
      answers: '{}',
      stages: [],
      risks: [],
      startDate: new Date(),
      pmHours: 0,
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('без токена и с токеном только на чтение/запись выгрузка запрещена', async () => {
    expect((await xlsx(get(), props)).status).toBe(401);
    expect((await xlsx(get(token(['read'])), props)).status).toBe(403);
    expect((await xlsx(get(token(['write'])), props)).status).toBe(403);
    expect((await xlsx(get(token(['export'], 'other')), props)).status).toBe(403);
    expect(loadSpecification).not.toHaveBeenCalled();
  });
  it('export-токен выгружает запрошенную редакцию с аудитом', async () => {
    const res = await xlsx(get(token(['export']), '?version=2'), props);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml');
    expect(res.headers.get('Content-Disposition')).toContain('SPEC_');
    expect(loadSpecification).toHaveBeenCalledWith('c1', 2);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Спецификация'], { header: 1 });
    expect(rows[1]).toContain('Сервер');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'specification.export.xlsx' }),
    );
  });
  it.each(['?version=0', '?version=abc', '?version=1.5'])('отклоняет версию %s', async (q) => {
    expect((await xlsx(get(token(['export']), q), props)).status).toBe(400);
  });
  it('несуществующая редакция — 404', async () => {
    expect((await xlsx(get(token(['export']), '?version=9'), props)).status).toBe(404);
  });
  it('выпуск ZIP включает SPEC.xlsx закрепленной редакции', async () => {
    const res = await release(
      new NextRequest('http://localhost/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Share-Token': token(['export']) },
        body: JSON.stringify({ docType: 'ZIP', isBatchZip: true, specificationVersion: 2 }),
      }),
      props,
    );
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const entry = zip.file('SPEC.xlsx');
    expect(entry).not.toBeNull();
    const wb = XLSX.read(await entry!.async('nodebuffer'), { type: 'buffer' });
    expect(
      XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Сведения'], { header: 1 }),
    ).toContainEqual(['Редакция', 2]);
    expect(releaseGostPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({ specificationVersion: 2 }),
        releaseSpecification: true,
      }),
    );
  });
  it('редакция выпускается только с явным выпуском SPEC, но не ТЗ и не GET-выгрузкой', async () => {
    const post = (body: unknown) =>
      release(
        new NextRequest('http://localhost/x', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Share-Token': token(['export']) },
          body: JSON.stringify(body),
        }),
        props,
      );
    expect((await post({ docType: 'SPEC', specificationVersion: 2 })).status).toBe(200);
    expect(createGostPackageVersion).toHaveBeenLastCalledWith(
      expect.objectContaining({ releaseSpecification: true }),
    );
    expect((await post({ docType: 'TZ', specificationVersion: 2 })).status).toBe(200);
    expect(createGostPackageVersion).toHaveBeenLastCalledWith(
      expect.objectContaining({ releaseSpecification: false }),
    );
    expect((await download(get(token(['export']), '?docType=SPEC'), props)).status).toBe(200);
    expect(createGostPackageVersion).toHaveBeenLastCalledWith(
      expect.objectContaining({ releaseSpecification: false }),
    );
    expect(releaseGostPackage).not.toHaveBeenCalled();
  });
});

describe('Предпросмотр импорта BOM', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'specification-output-secret-32b');
    vi.stubEnv('ALLOW_ANONYMOUS_PRESALE', 'false');
  });
  afterEach(() => vi.unstubAllEnvs());
  const upload = (share: string | undefined, content: string, profile = '{}') => {
    const form = new FormData();
    form.set('file', new File([content], 'bom.csv'));
    form.set('profile', profile);
    return new NextRequest('http://localhost/x', {
      method: 'POST',
      body: form,
      headers: share ? { 'X-Share-Token': share } : {},
    });
  };
  it('требует права записи', async () => {
    expect((await bomPreview(upload(undefined, 'a'), props)).status).toBe(401);
    expect((await bomPreview(upload(token(['read', 'export']), 'a'), props)).status).toBe(403);
  });
  it('возвращает строки и ошибки, ничего не сохраняя', async () => {
    const res = await bomPreview(
      upload(token(['write']), 'Наименование;Кол-во\nA;1\n;2', '{"delimiter":";"}'),
      props,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rows.map((r: { errors: string[] }) => r.errors.length)).toEqual([0, 1]);
    expect(data.rows[0].item).toMatchObject({ name: 'A', quantity: '1', confirmed: false });
  });
  it('отклоняет некорректный профиль и формат', async () => {
    expect((await bomPreview(upload(token(['write']), 'a', '{bad'), props)).status).toBe(400);
    const form = new FormData();
    form.set('file', new File(['x'], 'bom.pdf'));
    const res = await bomPreview(
      new NextRequest('http://localhost/x', {
        method: 'POST',
        body: form,
        headers: { 'X-Share-Token': token(['write']) },
      }),
      props,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/XLSX/);
  });
});
