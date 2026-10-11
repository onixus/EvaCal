import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Маршруты запросов на изменение поверх in-memory Prisma. Главное, что здесь
 * проверяется: создание, правка, передача на оценку, оценка и решения не
 * меняют базовые расчёт, этапы и комплект (#103 §1, приёмка); принятие
 * создаёт новую версию от базы в той же транзакции и откатывается целиком.
 * Сама запись версии и комплекта проверяется на живой БД
 * (scripts/verify-change-requests.ts), здесь — её вызов и атомарность.
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
    risks: [] as Row[],
    alwaysDuplicate: false,
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
    Object.entries(where).every(([k, v]) =>
      v instanceof Date
        ? row[k] instanceof Date && row[k].getTime() === v.getTime()
        : v && typeof v === 'object' && 'not' in v
          ? row[k] !== v.not
          : row[k] === v,
    );
  const decimal = (v: unknown) =>
    v === null || v === undefined ? null : { toFixed: (n: number) => Number(v).toFixed(n) };
  let counter = 0;
  const client: Row = {
    project: Object.assign(forbidden('project'), {
      findUnique: async ({ where }: Row) => state.projects.find((p) => p.id === where.id) ?? null,
      // Первоначальная база проекта — не часть базового расчёта.
      updateMany: async ({ where, data }: Row) => {
        const rows = state.projects.filter((p) => matches(p, where));
        rows.forEach((p) => Object.assign(p, data));
        return { count: rows.length };
      },
    }),
    risk: Object.assign(forbidden('risk'), {
      create: async ({ data }: Row) => {
        const row = { id: `risk${++counter}`, ...data };
        state.risks.push(row);
        return row;
      },
    }),
    calculation: Object.assign(forbidden('calculation'), {
      findUnique: async ({ where }: Row) => {
        const calc = state.calculations.find((c) => c.id === where.id);
        if (!calc) return null;
        return {
          ...calc,
          stages: state.stages.filter((s) => s.calculationId === calc.id),
          risks: [],
          stageDependencies: [],
        };
      },
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
      findUnique: async ({ where }: Row) => state.packages.find((p) => p.id === where.id) ?? null,
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
        if (state.alwaysDuplicate) throw Object.assign(new Error('unique'), { code: 'P2002' });
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
      deleteMany: async ({ where }: Row) => {
        const before = state.crs.length;
        state.crs = state.crs.filter((r) => !matches(r, where));
        return { count: before - state.crs.length };
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
    acceptanceCheck: { findMany: async () => [] },
    changeRequestEvent: {
      create: async ({ data }: Row) => {
        const row = { id: `ev${++counter}`, comment: null, data: null, at: new Date(), ...data };
        state.events.push(row);
        return row;
      },
    },
  };
  client.$executeRaw = async () => 1; // advisory lock
  // Транзакция с откатом: ошибка внутри восстанавливает изменяемые строки.
  client.$transaction = async (fn: (tx: Row) => unknown) => {
    const crs = state.crs.map((r) => ({ ...r }));
    const events = [...state.events];
    const risks = [...state.risks];
    const projects = state.projects.map((p) => ({ ...p }));
    try {
      return await fn(client);
    } catch (error) {
      state.crs = crs;
      state.events = events;
      state.risks = risks;
      state.projects = projects;
      throw error;
    }
  };
  return { state, writes, client };
});

vi.mock('@/lib/prisma', () => ({ prisma: db.client }));
vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));
vi.mock('@/lib/project', () => ({
  createCalculationVersion: vi.fn(async () => ({
    id: 'c-new',
    version: 3,
    stages: [
      { id: 'N1', name: 'Проектирование', role: 'architect', order: 0, isApprovalTask: false },
      { id: 'N2', name: 'Разработка', role: 'engineer', order: 1, isApprovalTask: false },
    ],
    risks: [],
  })),
  createDraftPackageVersion: vi.fn(async () => ({ id: 'p-new', version: 2 })),
}));
vi.mock('@/lib/changeRequests/notify', () => ({ notifyChangeRequest: vi.fn() }));
vi.mock('@/lib/changelog', () => ({ recordInternalChangeTx: vi.fn(async () => ({ id: 'ic1' })) }));

import { requireApiRole } from '@/lib/auth';
import { createCalculationVersion, createDraftPackageVersion } from '@/lib/project';
import { recordInternalChangeTx } from '@/lib/changelog';
import { notifyChangeRequest } from '@/lib/changeRequests/notify';
import { GET as list, POST as create } from '@/app/api/projects/[id]/change-requests/route';
import { DELETE, GET as getOne, PATCH } from '@/app/api/projects/[id]/change-requests/[crId]/route';

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
  db.state.projects = [
    { id: 'pr1', wonCalculationId: 'c1', baselineCalculationId: null },
    { id: 'pr2', wonCalculationId: null, baselineCalculationId: null },
  ];
  db.state.risks = [];
  db.state.calculations = [
    { id: 'c1', projectId: 'pr1', version: 1, currency: 'RUB', startDate: new Date('2026-11-02') },
    { id: 'c2', projectId: 'pr1', version: 2, currency: 'RUB', startDate: new Date('2026-11-02') },
    { id: 'cx', projectId: 'pr2', version: 1, currency: 'RUB', startDate: new Date('2026-11-02') },
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
      name: 'Комплект',
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '1',
      generatorVersion: '1',
      metadata: null,
      documentTypes: '["tz","pmi"]',
      snapshot: JSON.stringify(snapshot),
    },
  ];
  db.state.crs = [];
  db.state.events = [];
  db.state.alwaysDuplicate = false;
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
        ruleRequirementIds: [],
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
    // Без версии черновика правка не принимается.
    expect((await PATCH(patch({ ...draft, action: 'update' }), crProps(cr.id))).status).toBe(400);
    const upd = await PATCH(
      patch({
        ...draft,
        action: 'update',
        updatedAt: cr.updatedAt,
        requirementIds: ['R1', 'R2'],
        proposedChanges: {},
      }),
      crProps(cr.id),
    );
    expect(upd.status).toBe(200);
    const updated = await upd.json();
    expect(updated.impact.stages.map((s: { id: string }) => s.id)).toEqual(['S1', 'S2']);
    // Правка по устаревшей версии — 409, черновик не перезаписан.
    const stale = await PATCH(
      patch({
        ...draft,
        action: 'update',
        title: 'Чужая правка',
        updatedAt: '2000-01-01T00:00:00.000Z',
      }),
      crProps(cr.id),
    );
    expect(stale.status).toBe(409);
    expect(db.state.crs[0].title).toBe(draft.title);
    await PATCH(patch({ action: 'submit' }), crProps(cr.id));
    expect(
      (
        await PATCH(
          patch({ ...draft, action: 'update', updatedAt: updated.updatedAt }),
          crProps(cr.id),
        )
      ).status,
    ).toBe(409);
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

  it('неизвестное действие — 400; решения по черновику — 409', async () => {
    const cr = await (await create(req(draft), props())).json();
    expect((await PATCH(patch({ action: 'drop' }), crProps(cr.id))).status).toBe(400);
    expect((await PATCH(patch({ action: 'accept' }), crProps(cr.id))).status).toBe(409);
    expect((await PATCH(patch({ action: 'reopen' }), crProps(cr.id))).status).toBe(409);
    expect(db.state.crs[0].status).toBe('draft');
  });

  async function estimatedCr() {
    const cr = await (await create(req(draft), props())).json();
    await PATCH(patch({ action: 'submit' }), crProps(cr.id));
    await PATCH(
      patch({ action: 'estimate', hours: 24, cost: '36000.00', scheduleDays: 2 }),
      crProps(cr.id),
    );
    return cr.id as string;
  }

  it('принятие: версия от базы, строка ИЗМ, комплект, ЛВИ, ссылки результата; база цела', async () => {
    const id = await estimatedCr();
    untouched();
    const res = await PATCH(patch({ action: 'accept', comment: 'Согласовано' }), crProps(id));
    expect(res.status).toBe(200);
    const accepted = await res.json();
    expect(accepted).toMatchObject({
      status: 'accepted',
      decidedBy: 'architect',
      resultCalculationId: 'c-new',
      resultPackageId: 'p-new',
    });
    expect(vi.mocked(createCalculationVersion).mock.calls[0][0]).toMatchObject({
      parentCalculationId: 'c1',
    });
    // Изменение — явная строка с подтверждёнными часами, а не сумма этапов.
    expect(db.state.risks).toEqual([
      expect.objectContaining({ calculationId: 'c-new', hours: 24, order: 0 }),
    ]);
    expect(db.state.risks[0].description).toMatch(/^ИЗМ-01 \(ЗИ-01\)/);
    // Комплект — снимок базы с правкой R1 и связями на этапы новой версии.
    const pkgInput = vi.mocked(createDraftPackageVersion).mock.calls[0][1];
    expect(pkgInput.calculationId).toBe('c-new');
    const reqs = pkgInput.snapshot.requirements as Array<Record<string, unknown>>;
    expect(reqs.find((r) => r.id === 'R1')).toMatchObject({
      description: 'Вход через SAML',
      changeRef: 'ИЗМ-01',
    });
    expect(pkgInput.snapshot.manualLinks).toEqual([
      expect.objectContaining({ sourceId: 'R1', targetId: 'N1' }),
      expect.objectContaining({ sourceId: 'R2', targetId: 'N2' }),
    ]);
    expect(vi.mocked(recordInternalChangeTx).mock.calls[0][1]).toMatchObject({
      calculationId: 'c-new',
      source: 'change_request',
      packageId: 'p-new',
    });
    expect(db.state.projects[0].baselineCalculationId).toBe('c1');
    expect(accepted.events.at(-1)).toMatchObject({ action: 'accepted', comment: 'Согласовано' });
    // Базовые расчёт, этапы и комплект не тронуты и после принятия.
    expect(JSON.stringify([db.state.calculations, db.state.stages, db.state.packages])).toBe(
      baseline,
    );
  });

  it('ошибка внутри принятия откатывает всё: статус, строку ИЗМ, журнал', async () => {
    const id = await estimatedCr();
    const eventsBefore = db.state.events.length;
    vi.mocked(createDraftPackageVersion).mockRejectedValueOnce(new Error('disk full'));
    expect((await PATCH(patch({ action: 'accept' }), crProps(id))).status).toBe(500);
    expect(db.state.crs[0]).toMatchObject({ status: 'submitted', resultCalculationId: null });
    expect(db.state.risks).toEqual([]);
    expect(db.state.events).toHaveLength(eventsBefore);
    expect(db.state.projects[0].baselineCalculationId).toBeNull();
  });

  it('база изменилась после оценки — принять нельзя до переоценки', async () => {
    const id = await estimatedCr();
    db.state.stages[1].hours = 450; // кто-то поправил базовый расчёт
    const res = await PATCH(patch({ action: 'accept' }), crProps(id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/переоцен/);
    expect((await (await getOne(req(), crProps(id))).json()).estimateMatchesBase).toBe(false);
    await PATCH(
      patch({ action: 'estimate', hours: 30, cost: '40000', scheduleDays: 3 }),
      crProps(id),
    );
    expect((await PATCH(patch({ action: 'accept' }), crProps(id))).status).toBe(200);
  });

  it('отклонить и отложить требуют причину; reopen очищает решение', async () => {
    const id = await estimatedCr();
    expect((await PATCH(patch({ action: 'reject' }), crProps(id))).status).toBe(400);
    const deferred = await PATCH(patch({ action: 'defer', comment: 'Бюджет Q3' }), crProps(id));
    expect(await deferred.json()).toMatchObject({ status: 'deferred', decidedBy: 'architect' });
    // Отложенный нельзя «передать» — только вернуть решением.
    expect((await PATCH(patch({ action: 'submit' }), crProps(id))).status).toBe(409);
    const reopened = await (await PATCH(patch({ action: 'reopen' }), crProps(id))).json();
    expect(reopened).toMatchObject({
      status: 'submitted',
      decidedBy: null,
      decidedAt: null,
      confirmedHours: 24, // база не менялась — оценка сохранена
    });
    expect(reopened.events.at(-1)).toMatchObject({
      action: 'reopened',
      data: { estimate: 'kept' },
    });
    const rejected = await PATCH(patch({ action: 'reject', comment: 'Вне рамок' }), crProps(id));
    expect((await rejected.json()).status).toBe('rejected');
    expect((await PATCH(patch({ action: 'reopen' }), crProps(id))).status).toBe(409);
    untouched();
  });

  it('reopen после изменения базы сбрасывает оценку', async () => {
    const id = await estimatedCr();
    await PATCH(patch({ action: 'defer', comment: 'Позже' }), crProps(id));
    db.state.stages[0].hours = 10;
    const reopened = await (await PATCH(patch({ action: 'reopen' }), crProps(id))).json();
    expect(reopened).toMatchObject({
      status: 'submitted',
      confirmedHours: null,
      confirmedCost: null,
      estimatedAt: null,
    });
    expect(reopened.events.at(-1).data).toEqual({ estimate: 'cleared' });
  });

  it('решения — только архитектор/админ', async () => {
    const id = await estimatedCr();
    vi.mocked(requireApiRole).mockResolvedValue(session('presale') as never);
    for (const action of ['accept', 'reject', 'defer', 'reopen']) {
      expect((await PATCH(patch({ action, comment: 'x' }), crProps(id))).status).toBe(403);
    }
    expect(db.state.crs[0].status).toBe('submitted');
  });

  it('цепочка: после принятия база — только результат; параллельная ветка не принимается', async () => {
    const first = await estimatedCr();
    const second = await estimatedCr(); // подан на ту же базу до принятия первого
    expect((await PATCH(patch({ action: 'accept' }), crProps(first))).status).toBe(200);
    const listed = await (await list(req(), props())).json();
    expect(listed.headCalculationId).toBe('c-new');
    const res = await PATCH(patch({ action: 'accept' }), crProps(second));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/ЗИ-01/);
    // Новый запрос на старой версии не создаётся.
    const stale = await create(
      req({ ...draft, basePackageId: null, requirementIds: [], proposedChanges: { summary: 'x' } }),
      props(),
    );
    expect(stale.status).toBe(400);
    expect((await stale.json()).error).toMatch(/текущая согласованная версия/);
  });

  it('база — выигранная версия: другая версия проекта не принимается', async () => {
    db.state.calculations.push({
      id: 'c3',
      projectId: 'pr1',
      version: 3,
      currency: 'RUB',
      startDate: new Date('2026-11-02'),
    });
    const res = await create(
      req({
        ...draft,
        baseCalculationId: 'c3',
        basePackageId: null,
        requirementIds: [],
        proposedChanges: { summary: 'x' },
      }),
      props(),
    );
    expect(res.status).toBe(400);
    // Пока сделка не выиграна и изменений нет — база любая версия проекта.
    db.state.projects[0].wonCalculationId = null;
    const ok = await create(
      req({
        ...draft,
        baseCalculationId: 'c3',
        basePackageId: null,
        requirementIds: [],
        proposedChanges: { summary: 'x' },
      }),
      props(),
    );
    expect(ok.status).toBe(201);
  });

  it('черновик и архивный комплект не могут быть базой', async () => {
    for (const status of ['draft', 'archived']) {
      db.state.packages[0].status = status;
      const res = await create(req(draft), props());
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/выпущенный действующий комплект/);
    }
  });

  it('события запроса уведомляют: подача, оценка, решение; правка черновика — нет', async () => {
    const cr = await (await create(req(draft), props())).json();
    await PATCH(
      patch({ ...draft, action: 'update', updatedAt: cr.updatedAt, title: 'Новое' }),
      crProps(cr.id),
    );
    expect(notifyChangeRequest).not.toHaveBeenCalled();
    await PATCH(patch({ action: 'submit', comment: 'Прошу оценить' }), crProps(cr.id));
    await PATCH(
      patch({ action: 'estimate', hours: 8, cost: '1000', scheduleDays: 1, comment: 'SAML' }),
      crProps(cr.id),
    );
    await PATCH(patch({ action: 'defer', comment: 'Бюджет' }), crProps(cr.id));
    await PATCH(patch({ action: 'reopen' }), crProps(cr.id));
    await PATCH(patch({ action: 'reject', comment: 'Вне рамок' }), crProps(cr.id));
    const calls = vi.mocked(notifyChangeRequest).mock.calls;
    expect(calls.map((c) => [c[0], c[3]])).toEqual([
      ['submitted', 'Прошу оценить'],
      ['estimated', 'SAML'],
      ['deferred', 'Бюджет'],
      ['reopened', null],
      ['rejected', 'Вне рамок'],
    ]);
    expect(calls[0][1]).toMatchObject({ id: cr.id, projectId: 'pr1', createdBy: 'architect' });
    expect(calls[0][2]).toEqual({ userId: 'u-architect', username: 'architect' });
    // Отказ в действии не уведомляет.
    vi.mocked(notifyChangeRequest).mockClear();
    expect((await PATCH(patch({ action: 'accept' }), crProps(cr.id))).status).toBe(409);
    expect(notifyChangeRequest).not.toHaveBeenCalled();
  });

  it('удалить можно только черновик запроса', async () => {
    const cr = await (await create(req(draft), props())).json();
    const id = await estimatedCr();
    expect((await DELETE(req(undefined, 'http://localhost/x', 'DELETE'), crProps(id))).status).toBe(
      409,
    );
    expect(
      (await DELETE(req(undefined, 'http://localhost/x', 'DELETE'), crProps(cr.id))).status,
    ).toBe(200);
    expect(db.state.crs.map((r) => r.id)).toEqual([id]);
    expect(
      (await DELETE(req(undefined, 'http://localhost/x', 'DELETE'), crProps('nope'))).status,
    ).toBe(404);
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

  it('исчерпав попытки присвоить номер, отвечает 409, а не 500', async () => {
    db.state.alwaysDuplicate = true;
    const res = await create(req(draft), props());
    expect(res.status).toBe(409);
    expect(db.state.crs).toEqual([]);
  });

  it('пустой запрос нельзя передать на оценку', async () => {
    const cr = await (
      await create(
        req({ ...draft, basePackageId: null, requirementIds: [], proposedChanges: {} }),
        props(),
      )
    ).json();
    expect((await PATCH(patch({ action: 'submit' }), crProps(cr.id))).status).toBe(400);
    // Проверка внутри транзакции перехода: статус и журнал откатились.
    expect(db.state.crs[0].status).toBe('draft');
    expect(db.state.events.map((e) => e.action)).toEqual(['created']);
  });
});
