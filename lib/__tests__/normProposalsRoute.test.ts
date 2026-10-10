/**
 * Маршруты предложений нормативов (#103 WP-6c) с хранилищем в памяти:
 * доступ только администратору, утверждение меняет только этап шаблона,
 * повторная генерация идемпотентна и заменяет устаревшие предложения.
 * То же на живой PostgreSQL — scripts/verify-norm-proposals.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  let seq = 0;
  const matches = (row: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as object)) {
        return (v as { in: unknown[] }).in.includes(row[k]);
      }
      if (v && typeof v === 'object') return true; // вложенные фильтры (project) — ниже
      return (row[k] ?? null) === v;
    });
  const model = (name: string) => {
    const t = () => (tables[name] ??= []);
    return {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        t()
          .filter((r) => matches(r, where))
          .map((r) => ({ ...r })),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const r = t().find((x) => matches(x, where));
        return r ? { ...r } : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = t().find((x) => x.id === where.id);
        return r ? { ...r } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        // Умолчания столбцов, как в БД.
        const defaults = name === 'normProposal' ? { status: 'proposed', decidedAt: null } : {};
        const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...defaults, ...data } as Row;
        t().push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = t().find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = t().filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    };
  };
  const prisma = {
    formTemplate: model('formTemplate'),
    stageTemplate: model('stageTemplate'),
    calculation: model('calculation'),
    stage: model('stage'),
    normProposal: model('normProposal'),
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    $executeRaw: async () => 0,
  };
  return { tables, prisma, session: { role: 'admin' as string } };
});

vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }));
vi.mock('@/lib/auth', () => ({
  requireApiRole: vi.fn(async (role: string | string[]) => {
    const allowed = Array.isArray(role) ? role : [role];
    if (!allowed.includes(db.session.role)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    return { userId: 'u1', username: 'owner', role: db.session.role, exp: 0 };
  }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));

import { GET, POST as GENERATE } from '@/app/api/templates/[id]/norm-proposals/route';
import { POST as DECIDE } from '@/app/api/templates/[id]/norm-proposals/[proposalId]/route';
import { PUT as PUT_STAGE } from '@/app/api/templates/[id]/stage-templates/[stId]/route';
import { POST as CREATE_STAGE } from '@/app/api/templates/[id]/stage-templates/route';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

const json = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const tplProps = { params: Promise.resolve({ id: 't1' }) };
const decideProps = (proposalId: string) => ({ params: Promise.resolve({ id: 't1', proposalId }) });

function wonCalc(i: number, actualHours: number | null) {
  return {
    id: `c${i}`,
    templateId: 't1',
    name: `Проект ${i}`,
    version: 1,
    answers: JSON.stringify({ sites: 5 }),
    project: { wonCalculationId: `c${i}`, actualsClosedAt: new Date() },
    stages: [
      {
        id: `s${i}`,
        name: 'Обследование',
        role: 'analyst',
        hours: 20,
        isApprovalTask: false,
        actualHours,
        actualEndDate: null,
      },
    ],
  };
}

describe('API предложений нормативов', () => {
  beforeEach(() => {
    for (const k of Object.keys(db.tables)) delete db.tables[k];
    db.session.role = 'admin';
    vi.mocked(writeAudit).mockClear();
    db.tables.formTemplate = [{ id: 't1' }];
    db.tables.stageTemplate = [
      {
        id: 'st1',
        templateId: 't1',
        name: 'Обследование',
        role: 'analyst',
        baseHours: 10,
        hoursPerUnit: 2,
        driverFieldKey: 'sites',
        order: 0,
      },
    ];
    db.tables.calculation = [wonCalc(1, 30), wonCalc(2, 30), wonCalc(3, 30)];
  });

  it('только администратор', async () => {
    for (const role of ['architect', 'presale', 'gap']) {
      db.session.role = role;
      expect((await GET(new NextRequest('http://localhost/x'), tplProps)).status).toBe(403);
      expect((await GENERATE(json({}), tplProps)).status).toBe(403);
      expect((await DECIDE(json({ decision: 'approve' }), decideProps('p'))).status).toBe(403);
    }
    expect(db.tables.normProposal ?? []).toHaveLength(0);
  });

  it('генерация идемпотентна, новые данные заменяют открытое предложение', async () => {
    const first = await (await GENERATE(json({}), tplProps)).json();
    expect(first.summary).toMatchObject({ created: 1, unchanged: 0, superseded: 0 });
    const again = await (await GENERATE(json({}), tplProps)).json();
    expect(again.summary).toMatchObject({ created: 0, unchanged: 1, superseded: 0 });
    expect(db.tables.normProposal).toHaveLength(1);

    db.tables.calculation.push(wonCalc(4, 40));
    const third = await (await GENERATE(json({}), tplProps)).json();
    expect(third.summary).toMatchObject({ created: 1, superseded: 1 });
    expect(db.tables.normProposal.map((p) => p.status).sort()).toEqual(['proposed', 'superseded']);
  });

  it('утверждение меняет только этап шаблона, этапы расчётов не трогает', async () => {
    await GENERATE(json({}), tplProps);
    const p = db.tables.normProposal[0];
    const stagesBefore = JSON.stringify(db.tables.calculation.map((c) => c.stages));

    const res = await DECIDE(json({ decision: 'approve', comment: 'ок' }), decideProps(p.id));
    expect(res.status).toBe(200);
    expect(db.tables.stageTemplate[0]).toMatchObject({ baseHours: 15, hoursPerUnit: 3 });
    expect(JSON.stringify(db.tables.calculation.map((c) => c.stages))).toBe(stagesBefore);
    expect(db.tables.normProposal[0]).toMatchObject({
      status: 'approved',
      decidedBy: 'owner',
      decisionComment: 'ок',
    });
    expect(vi.mocked(writeAudit)).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'template.norms.approve', entityId: 't1' }),
    );

    // Повторное решение отклоняется.
    expect((await DECIDE(json({ decision: 'approve' }), decideProps(p.id))).status).toBe(409);
  });

  it('устаревший снимок норматива не утверждается', async () => {
    await GENERATE(json({}), tplProps);
    db.tables.stageTemplate[0].baseHours = 12;
    const p = db.tables.normProposal[0];
    const res = await DECIDE(json({ decision: 'approve' }), decideProps(p.id));
    expect(res.status).toBe(409);
    expect(db.tables.stageTemplate[0].baseHours).toBe(12);
    expect(db.tables.normProposal[0].status).toBe('proposed');
  });

  it('отклонение требует причины и не меняет шаблон', async () => {
    await GENERATE(json({}), tplProps);
    const p = db.tables.normProposal[0];
    expect((await DECIDE(json({ decision: 'reject' }), decideProps(p.id))).status).toBe(400);
    const res = await DECIDE(
      json({ decision: 'reject', comment: 'мало данных' }),
      decideProps(p.id),
    );
    expect(res.status).toBe(200);
    expect(db.tables.stageTemplate[0]).toMatchObject({ baseHours: 10, hoursPerUnit: 2 });
    expect(db.tables.normProposal[0].status).toBe('rejected');
  });

  it('предложение другого шаблона не находится', async () => {
    await GENERATE(json({}), tplProps);
    const p = db.tables.normProposal[0];
    const res = await DECIDE(json({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'other', proposalId: p.id }),
    });
    expect(res.status).toBe(404);
  });

  it('отклонённое предложение не создаётся заново по тем же данным', async () => {
    await GENERATE(json({}), tplProps);
    const p = db.tables.normProposal[0];
    await DECIDE(json({ decision: 'reject', comment: 'нет' }), decideProps(p.id));
    const again = await (await GENERATE(json({}), tplProps)).json();
    expect(again.summary).toMatchObject({ created: 0, unchanged: 0 });
    expect(again.summary.skipped).toEqual([
      expect.objectContaining({ stageTemplateId: 'st1', reason: 'rejected-same-data' }),
    ]);
    expect(db.tables.normProposal).toHaveLength(1);
    // Новые данные — новое предложение.
    db.tables.calculation.push(wonCalc(4, 40));
    const fresh = await (await GENERATE(json({}), tplProps)).json();
    expect(fresh.summary.created).toBe(1);
  });

  it('смена драйвера, имени или роли этапа — 409 при утверждении', async () => {
    for (const change of [{ driverFieldKey: 'users' }, { name: 'Аудит' }, { role: 'architect' }]) {
      for (const k of Object.keys(db.tables)) if (k === 'normProposal') delete db.tables[k];
      const st = db.tables.stageTemplate[0];
      Object.assign(st, { name: 'Обследование', role: 'analyst', driverFieldKey: 'sites' });
      await GENERATE(json({}), tplProps);
      const p = db.tables.normProposal[0];
      Object.assign(st, change);
      const res = await DECIDE(json({ decision: 'approve' }), decideProps(p.id));
      expect(res.status).toBe(409);
      expect(st).toMatchObject({ baseHours: 10, hoursPerUnit: 2 });
      expect(db.tables.normProposal[0].status).toBe('proposed');
    }
  });

  it('условное обновление: 0 строк — 409, предложение остаётся открытым', async () => {
    await GENERATE(json({}), tplProps);
    const p = db.tables.normProposal[0];
    const spy = vi
      .spyOn(prisma.stageTemplate, 'updateMany')
      .mockResolvedValueOnce({ count: 0 } as never);
    const res = await DECIDE(json({ decision: 'approve' }), decideProps(p.id));
    expect(res.status).toBe(409);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'st1',
          baseHours: 10,
          hoursPerUnit: 2,
          driverFieldKey: 'sites',
          name: 'Обследование',
          role: 'analyst',
        }),
      }),
    );
    expect(db.tables.normProposal[0].status).toBe('proposed');
    spy.mockRestore();
  });

  it('правка этапа шаблона: блокировка нормативов и проверка знака', async () => {
    const lock = vi.spyOn(prisma, '$executeRaw');
    const put = (body: unknown) =>
      PUT_STAGE(
        new NextRequest('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) }),
        {
          params: Promise.resolve({ id: 't1', stId: 'st1' }),
        },
      );
    expect((await put({ baseHours: -1 })).status).toBe(400);
    expect((await put({ hoursPerUnit: -0.5 })).status).toBe(400);
    expect((await put({ baseHours: 'x' })).status).toBe(400);
    expect(db.tables.stageTemplate[0].baseHours).toBe(10);
    expect(lock).not.toHaveBeenCalled();

    expect((await put({ baseHours: 12 })).status).toBe(200);
    expect(db.tables.stageTemplate[0].baseHours).toBe(12);
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock.mock.calls[0].slice(1)).toEqual(['norms:t1']);

    const other = await PUT_STAGE(
      new NextRequest('http://localhost/x', { method: 'PUT', body: '{"baseHours":1}' }),
      { params: Promise.resolve({ id: 'other', stId: 'st1' }) },
    );
    expect(other.status).toBe(404);
    lock.mockRestore();

    const created = await CREATE_STAGE(
      json({ name: 'X', role: 'analyst', baseHours: -3 }),
      tplProps,
    );
    expect(created.status).toBe(400);
  });
});
