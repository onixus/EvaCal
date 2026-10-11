/**
 * Маршруты `/api/calculations/:id/kits/*` (#103 WP-7b): допуск ролей,
 * проверка тела, передача адаптации в хранилище, коды ответов. Хранилище
 * замокано; запись в БД — scripts/verify-kit-application.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({ role: 'architect' as string }));

vi.mock('@/lib/auth', () => ({
  requireApiRole: vi.fn(async (role: string | string[]) => {
    const allowed = Array.isArray(role) ? role : [role];
    if (!state.role) return NextResponse.json({ error: 'auth' }, { status: 401 });
    if (!allowed.includes(state.role)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    return { userId: 'u1', username: 'arch', role: state.role, exp: 0 };
  }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));
vi.mock('@/lib/kitApplication/store', () => ({
  applyKit: vi.fn(),
  applyKitUpdate: vi.fn(),
  previewKitApplication: vi.fn(),
  kitUpdateProposals: vi.fn(),
  listKitApplications: vi.fn(),
}));

import { GET as LIST } from '@/app/api/calculations/[id]/kits/route';
import { POST as PREVIEW } from '@/app/api/calculations/[id]/kits/preview/route';
import { POST as APPLY } from '@/app/api/calculations/[id]/kits/apply/route';
import { POST as UPDATE } from '@/app/api/calculations/[id]/kits/update/route';
import * as store from '@/lib/kitApplication/store';
import { writeAudit } from '@/lib/audit';

const props = { params: Promise.resolve({ id: 'calc1' }) };
const req = (body?: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  });
const selection = { targets: { calculation: true, package: true } };

describe('API наборов решений расчёта', () => {
  beforeEach(() => {
    state.role = 'architect';
    vi.mocked(writeAudit).mockClear();
    vi.mocked(store.applyKit).mockReset();
    vi.mocked(store.applyKitUpdate).mockReset();
  });

  it('допуск: без входа 401, пресейл и ГАП 403', async () => {
    state.role = '';
    expect((await LIST(req(), props)).status).toBe(401);
    for (const role of ['presale', 'gap', 'techwriter']) {
      state.role = role;
      expect((await LIST(req(), props)).status).toBe(403);
      expect((await APPLY(req({ kitId: 'k', selection }), props)).status).toBe(403);
      expect((await UPDATE(req({ kitId: 'k', toVersion: 2, elementIds: [] }), props)).status).toBe(
        403,
      );
    }
    expect(store.applyKit).not.toHaveBeenCalled();
  });

  it('список: журнал и предложения', async () => {
    vi.mocked(store.kitUpdateProposals).mockResolvedValue({ ok: true, proposals: [] });
    vi.mocked(store.listKitApplications).mockResolvedValue([]);
    const res = await LIST(req(), props);
    expect(await res.json()).toEqual({ applications: [], proposals: [] });
  });

  it('применение: проверка тела, нормализованная адаптация, аудит', async () => {
    expect((await APPLY(req({ selection }), props)).status).toBe(400);
    expect((await APPLY(req({ kitId: 'k', version: 0, selection }), props)).status).toBe(400);
    expect((await APPLY(req({ kitId: 'k', selection: { targets: {} } }), props)).status).toBe(400);
    expect((await APPLY(req([1]), props)).status).toBe(400);

    vi.mocked(store.applyKit).mockResolvedValue({
      ok: true,
      applicationId: 'a1',
      calculationId: 'calc2',
      packageId: 'p1',
      noop: false,
    });
    const res = await APPLY(
      req({
        kitId: 'k',
        version: 2,
        selection: { ...selection, excluded: ['b', 'a'] },
        createVersion: true,
      }),
      props,
    );
    expect(res.status).toBe(201);
    expect(store.applyKit).toHaveBeenCalledWith(
      { username: 'arch' },
      {
        calculationId: 'calc1',
        kitId: 'k',
        version: 2,
        createVersion: true,
        selection: {
          targets: { calculation: true, package: true },
          excluded: ['a', 'b'],
          overrides: {},
          driverValues: {},
        },
      },
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'calculation.kit.apply', entityId: 'calc2' }),
    );
  });

  it('применение: отказ хранилища передаётся кодом (409 — не черновик)', async () => {
    vi.mocked(store.applyKit).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Расчёт не черновик',
    });
    const res = await APPLY(req({ kitId: 'k', selection }), props);
    expect(res.status).toBe(409);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('предпросмотр: план без записи', async () => {
    vi.mocked(store.previewKitApplication).mockResolvedValue({
      ok: true,
      plan: { stages: [] } as never,
      kit: { id: 'k', key: 'kk', name: 'N', version: 1 },
      content: {} as never,
    });
    const res = await PREVIEW(req({ kitId: 'k', selection }), props);
    expect(res.status).toBe(200);
    expect(store.applyKit).not.toHaveBeenCalled();
  });

  it('обновление: проверка тела и передача выбранных элементов', async () => {
    expect((await UPDATE(req({ kitId: 'k', elementIds: ['a'] }), props)).status).toBe(400);
    expect((await UPDATE(req({ kitId: 'k', toVersion: 2, elementIds: [1] }), props)).status).toBe(
      400,
    );
    expect(
      (
        await UPDATE(
          req({ kitId: 'k', toVersion: 2, elementIds: ['a'], driverValues: { s: -1 } }),
          props,
        )
      ).status,
    ).toBe(400);
    vi.mocked(store.applyKitUpdate).mockResolvedValue({
      ok: true,
      applicationId: 'a2',
      calculationId: 'calc3',
      packageId: null,
      noop: false,
    });
    const res = await UPDATE(req({ kitId: 'k', toVersion: 2, elementIds: ['stage-01'] }), props);
    expect(res.status).toBe(201);
    expect(store.applyKitUpdate).toHaveBeenCalledWith(
      { username: 'arch' },
      {
        calculationId: 'calc1',
        kitId: 'k',
        toVersion: 2,
        elementIds: ['stage-01'],
        driverValues: {},
      },
    );
  });

  it('слишком большое тело — 413', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    expect((await APPLY(req({ kitId: 'k', selection, pad: big }), props)).status).toBe(413);
  });
});
