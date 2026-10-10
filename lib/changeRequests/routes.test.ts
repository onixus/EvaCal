import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Маршруты запросов на изменение поверх in-memory Prisma. Главное, что здесь
 * проверяется: создание, правка, передача на оценку и оценка пишут только
 * ChangeRequest/ChangeRequestEvent — базовые расчёт, этапы и комплект не
 * меняются ни одним вызовом (#103 §1, приёмка).
 */

const db = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    projects: [] as Row[],
    calculations: [] as Row[],
    stages: [] as Row[],
    packages: [] as Row[],
    crs: [] as Row[],
    events: [] as Row[],
  };
  const writes: string[] = [];
  const forbidden = (model: string) =>
    new Proxy(
      {},
      {
        get: (target: Row, method: string) => {
          if (method in target) return target[method];
          if (['findUnique', 'findFirst', 'findMany', 'count'].includes(method)) return undefined;
          return async () => {
            writes.push(`${model}.${method}`);
            throw new Error(`write to ${model}.${method} is forbidden`);
          };
        },
      },
    );
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  const decimal = (v: unknown) =>
    v === null || v === undefined ? null : { toFixed: (n: number) => Number(v).toFixed(n) };
  let counter = 0;
  const client: Row = {
    project: Object.assign(forbidden('project'), {
      findUnique: async ({ where }: Row) => state.projects.find((p) => p.id === where.id) ?? null,
    }),
    calculation: Object.assign(forbidden('calculation'), {
      findFirst: async ({ where }: Row) => {
        const calc = state.calculations.find((c) => matches(c, where));
        if (!calc) return null;
        return {
          ...calc,
          stages: state.stages
            .filter((s) => s.calculationId === calc.id)
            .sort((a, b) => a.order - b.order),
        };
      },
    }),
    stage: forbidden('stage'),
    gostPackage: Object.assign(forbidden('gostPackage'), {
      findFirst: async ({ where }: Row) => state.packages.find((p) => matches(p, where)) ?? null,
    }),
    changeRequest: {
      findMany: async ({ where }: Row) =>
        state.crs.filter((r) => matches(r, where)).sort((a, b) => b.seq - a.seq),
      findFirst: async ({ where, orderBy, include }: Row) => {
        let rows = state.crs.filter((r) => matches(r, where));
        if (orderBy?.seq === 'desc') rows = rows.sort((a, b) => b.seq - a.seq);
        const row = rows[0];
        if (!row) return null;
        return include?.events
          ? { ...row, events: state.events.filter((e) => e.crId === row.id) }
          : row;
      },
      create: async ({ data }: Row) => {
        if (state.crs.some((r) => r.projectId === data.projectId && r.seq === data.seq)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const now = new Date();
        const row = {
          id: `cr${++counter}`,
          status: 'draft',
          impact: null,
          confirmedHours: null,
          confirmedCost: null,
          confirmedScheduleDays: null,
          estimateComment: null,
          estimatedBy: null,
          estimatedAt: null,
          decidedBy: null,
          decidedAt: null,
          resultCalculationId: null,
          resultPackageId: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.crs.push(row);
        return row;
      },
      updateMany: async ({ where, data }: Row) => {
        const rows = state.crs.filter((r) => matches(r, where));
        for (const row of rows) {
          Object.assign(row, data, { updatedAt: new Date() });
          if ('confirmedCost' in data) row.confirmedCost = decimal(data.confirmedCost);
        }
        return { count: rows.length };
      },
    },
    changeRequestEvent: {
      create: async ({ data }: Row) => {
        const row = { id: `ev${++counter}`, comment: null, data: null, at: new Date(), ...data };
        state.events.push(row);
        return row;
      },
    },
  };
  client.$transaction = async (fn: (tx: Row) => unknown) => fn(client);
  return { state, writes, client };
});

vi.mock('@/lib/prisma', () => ({ prisma: db.client }));
vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));

import { requireApiRole } from '@/lib/auth';
import { GET as list, POST as create } from '@/app/api/projects/[id]/change-requests/route';
import { GET as getOne, PATCH } from '@/app/api/projects/[id]/change-requests/[crId]/route';

const snapshot = {
  requirements: [
    { id: 'R1', code: 'ТР-01', description: 'Вход по паролю', criterion: 'Вход проходит' },
    { id: 'R2', code: 'ТР-02', description: 'Журнал событий' },
  ],
  manualLinks: [
    { sourceId: 'R1', targetId: 'S1', method: 'MANUAL', approved: true },
    { sourceId: 'R2', targetId: 'S2', method: 'MANUAL', approved: true },
  ],
};

function seed() {
  db.state.projects = [{ id: 'pr1' }, { id: 'pr2' }];
  db.state.calculations = [
    { id: 'c1', projectId: 'pr1', version: 1, currency: 'RUB' },
    { id: 'c2', projectId: 'pr1', version: 2, currency: 'RUB' },
    { id: 'cx', projectId: 'pr2', version: 1, currency: 'RUB' },
  ];
  db.state.stages = [
    {
      id: 'S1',
      calculationId: 'c1',
      name: 'Проектирование',
      role: 'architect',
      hours: 120,
      order: 0,
      isApprovalTask: false,
    },
    {
      id: 'S2',
      calculationId: 'c1',
      name: 'Разработка',
      role: 'engineer',
      hours: 400,
      order: 1,
      isApprovalTask: false,
    },
  ];
  db.state.packages = [
    {
      id: 'p1',
      projectId: 'pr1',
      calculationId: 'c1',
      version: 1,
      documentTypes: '["tz","pmi"]',
      snapshot: JSON.stringify(snapshot),
    },
  ];
  db.state.crs = [];
  db.state.events = [];
  db.writes.length = 0;
}

const session = (role: string) => ({ userId: `u-${role}`, username: role, role, exp: 0 });
const props = (id = 'pr1') => ({ params: Promise.resolve({ id }) });
const crProps = (crId: string, id = 'pr1') => ({ params: Promise.resolve({ id, crId }) });
const req = (body?: unknown, url = 'http://localhost/x', method = body ? 'POST' : 'GET') =>
  new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json' },
  });
const patch = (body: unknown) => req(body, 'http://localhost/x', 'PATCH');

const draft = {
  title: 'Добавить SSO',
  initiator: 'Заказчик',
  reason: 'Требование ИБ',
  baseCalculationId: 'c1',
  basePackageId: 'p1',
  requirementIds: ['R1'],
  proposedChanges: {
    summary: 'SSO',
    items: [{ kind: 'modify', requirementId: 'R1', text: 'Вход через SAML' }],
  },
};

describe('Маршруты запросов на изменение', () => {
  let baseline: string;
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    baseline = JSON.stringify([db.state.calculations, db.state.stages, db.state.packages]);
    vi.mocked(requireApiRole).mockImplementation(async (roles) =>
      (roles as string[]).includes('architect') ? (session('architect') as never) : (null as never),
    );
  });
  const untouched = () => {
    expect(db.writes).toEqual([]);
    expect(JSON.stringify([db.state.calculations, db.state.stages, db.state.packages])).toBe(
      baseline,
    );
  };

  it('создание и передача на оценку не меняют базовые расчёт, этапы и комплект', async () => {
    const res = await create(req(draft), props());
    expect(res.status).toBe(201);
    const cr = await res.json();
    expect(cr).toMatchObject({
      seq: 1,
      status: 'draft',
      affectedRequirements: [{ id: 'R1', code: 'ТР-01', text: 'Вход по паролю' }],
      confirmedHours: null,
      confirmedCost: null,
      confirmedScheduleDays: null,
    });
    // Влияние: этап с часами как контекст, без суммы и без оценки.
    expect(cr.impact.stages).toEqual([
      {
        id: 'S1',
        name: 'Проектирование',
        role: 'architect',
        baseHours: 120,
        requirementIds: ['R1'],
      },
    ]);
    expect(cr.impact.documents.map((d: { type: string }) => d.type)).toEqual(['tz', 'pmi']);
    untouched();

    const sub = await PATCH(patch({ action: 'submit', comment: 'Прошу оценить' }), crProps(cr.id));
    expect(sub.status).toBe(200);
    const submitted = await sub.json();
    expect(submitted.status).toBe('submitted');
    expect(submitted.confirmedHours).toBeNull();
    expect(submitted.events.map((e: { action: string }) => e.action)).toEqual([
      'created',
      'submitted',
    ]);
    untouched();
  });

  it('оценка — только явные значения специалиста; база не меняется', async () => {
    const cr = await (await create(req(draft), props())).json();
    // Пока черновик — оценка запрещена.
    expect(
      (
        await PATCH(
          patch({ action: 'estimate', hours: 8, cost: '1000', scheduleDays: 1 }),
          crProps(cr.id),
        )
      ).status,
    ).toBe(409);
    await PATCH(patch({ action: 'submit' }), crProps(cr.id));
    // Без часов оценки нет — ничего не подставляется из этапов.
    expect(
      (await PATCH(patch({ action: 'estimate', cost: '1000', scheduleDays: 1 }), crProps(cr.id)))
        .status,
    ).toBe(400);
    const ok = await PATCH(
      patch({ action: 'estimate', hours: 24, cost: '36000.00', scheduleDays: 2, comment: 'SAML' }),
      crProps(cr.id),
    );
    expect(ok.status).toBe(200);
    const estimated = await ok.json();
    expect(estimated).toMatchObject({
      status: 'submitted',
      confirmedHours: 24,
      confirmedCost: '36000.00',
      confirmedScheduleDays: 2,
      estimatedBy: 'architect',
    });
    expect(estimated.confirmedHours).not.toBe(120); // не часы связанного этапа
    expect(estimated.events.at(-1)).toMatchObject({
      action: 'estimated',
      data: { hours: 24, cost: '36000.00', scheduleDays: 2 },
    });
    untouched();
  });

  it('пресейл ведёт запрос, но оценку не подтверждает', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale') as never);
    const cr = await (await create(req(draft), props())).json();
    await PATCH(patch({ action: 'submit' }), crProps(cr.id));
    const res = await PATCH(
      patch({ action: 'estimate', hours: 8, cost: '1', scheduleDays: 0 }),
      crProps(cr.id),
    );
    expect(res.status).toBe(403);
    expect(db.state.crs[0].estimatedAt).toBeNull();
  });

  it('без роли — отказ гейта', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(requireApiRole).mockResolvedValue(
      NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }) as never,
    );
    expect((await create(req(draft), props())).status).toBe(403);
    expect((await list(req(), props())).status).toBe(403);
    expect(db.state.crs).toEqual([]);
  });

  it('правка — только черновик; после передачи база зафиксирована', async () => {
    const cr = await (await create(req(draft), props())).json();
    const upd = await PATCH(
      patch({ ...draft, action: 'update', requirementIds: ['R1', 'R2'], proposedChanges: {} }),
      crProps(cr.id),
    );
    expect(upd.status).toBe(200);
    expect((await upd.json()).impact.stages.map((s: { id: string }) => s.id)).toEqual(['S1', 'S2']);
    await PATCH(patch({ action: 'submit' }), crProps(cr.id));
    expect((await PATCH(patch({ ...draft, action: 'update' }), crProps(cr.id))).status).toBe(409);
    expect((await PATCH(patch({ action: 'submit' }), crProps(cr.id))).status).toBe(409);
    untouched();
  });

  it('база проверяется: чужой проект, комплект другой версии, чужие требования', async () => {
    expect(
      (await create(req({ ...draft, baseCalculationId: 'cx', basePackageId: null }), props()))
        .status,
    ).toBe(400);
    expect((await create(req({ ...draft, baseCalculationId: 'c2' }), props())).status).toBe(400);
    expect((await create(req({ ...draft, requirementIds: ['R9'] }), props())).status).toBe(400);
    expect(
      (await create(req({ ...draft, basePackageId: null, proposedChanges: {} }), props())).status,
    ).toBe(400);
    expect((await create(req(draft), props('nope'))).status).toBe(404);
    expect(db.state.crs).toEqual([]);
  });

  it('решения и неизвестные действия в этом этапе не поддерживаются', async () => {
    const cr = await (await create(req(draft), props())).json();
    for (const action of ['accept', 'reject', 'defer', 'drop']) {
      expect((await PATCH(patch({ action }), crProps(cr.id))).status).toBe(400);
    }
    expect(db.state.crs[0].status).toBe('draft');
  });

  it('нумерация сквозная в проекте; список, карточка и требования базы', async () => {
    await create(req(draft), props());
    await create(req({ ...draft, title: 'Второй' }), props());
    const listed = await (await list(req(), props())).json();
    expect(listed.changeRequests.map((c: { seq: number }) => c.seq)).toEqual([2, 1]);
    const one = await getOne(req(), crProps(listed.changeRequests[0].id));
    expect((await one.json()).title).toBe('Второй');
    expect((await getOne(req(), crProps(listed.changeRequests[0].id, 'pr2'))).status).toBe(404);
    const reqs = await list(req(undefined, 'http://localhost/x?packageId=p1'), props());
    expect((await reqs.json()).requirements.map((r: { id: string }) => r.id)).toEqual(['R1', 'R2']);
    untouched();
  });

  it('пустой запрос нельзя передать на оценку', async () => {
    const cr = await (
      await create(
        req({ ...draft, basePackageId: null, requirementIds: [], proposedChanges: {} }),
        props(),
      )
    ).json();
    expect((await PATCH(patch({ action: 'submit' }), crProps(cr.id))).status).toBe(400);
  });
});
