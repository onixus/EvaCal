/**
 * Маршруты библиотеки решений (#103 WP-7a) с хранилищем в памяти: допуск
 * ролей, владелец и утверждение, неизменность утверждённой версии, новая
 * версия копирует последнюю и не меняет старую. Триггер БД и сид на живой
 * PostgreSQL — scripts/verify-solution-kits.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => {
  const kits: Row[] = [];
  const versions: Row[] = [];
  const users: Row[] = [];
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  let clock = Date.UTC(2026, 0, 1);
  const tick = () => new Date((clock += 1000));
  const pick = (r: Row | undefined) => (r ? { ...r } : null);
  const versionMatch = (v: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, val]) => {
      if (k === 'version' && val && typeof val === 'object') {
        return (v.version as number) < (val as { lt: number }).lt;
      }
      if (val instanceof Date) return (v[k] as Date)?.getTime() === val.getTime();
      return v[k] === val;
    });
  const byVersionDesc = (a: Row, b: Row) => (b.version as number) - (a.version as number);
  const withKit = (v: Row | null, include?: Record<string, unknown>) => {
    if (!v || !include?.kit) return v;
    const kit = kits.find((k) => k.id === v.kitId)!;
    return { ...v, kit: { ...kit } };
  };

  const prisma = {
    solutionKit: {
      findMany: async () =>
        kits.map((k) => ({
          ...k,
          versions: versions
            .filter((v) => v.kitId === k.id)
            .sort(byVersionDesc)
            .map((v) => ({ version: v.version, status: v.status })),
        })),
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const k = kits.find((x) => x.id === where.id);
        if (!k) return null;
        if (!include) return { ...k };
        return {
          ...k,
          versions: versions
            .filter((v) => v.kitId === k.id)
            .sort(byVersionDesc)
            .map((v) => ({ ...v })),
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (kits.some((k) => k.key === data.key)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const { versions: nested, ...rest } = data as {
          versions?: { create: Record<string, unknown> };
        } & Record<string, unknown>;
        const kit = { id: id('kit'), status: 'draft', ...rest } as Row;
        kits.push(kit);
        if (nested) {
          versions.push({
            id: id('ver'),
            kitId: kit.id,
            status: 'draft',
            approvedBy: null,
            approvedAt: null,
            createdAt: new Date(),
            updatedAt: tick(),
            ...nested.create,
          });
        }
        return { id: kit.id, key: kit.key };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const k = kits.find((x) => x.id === where.id)!;
        Object.assign(k, data);
        return { ...k };
      },
    },
    solutionKitVersion: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { kitId_version: { kitId: string; version: number } };
        include?: Record<string, unknown>;
      }) =>
        withKit(
          pick(
            versions.find(
              (v) =>
                v.kitId === where.kitId_version.kitId && v.version === where.kitId_version.version,
            ),
          ),
          include,
        ),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        pick(versions.filter((v) => versionMatch(v, where)).sort(byVersionDesc)[0]),
      count: async ({ where }: { where: Record<string, unknown> }) =>
        versions.filter((v) => versionMatch(v, where)).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (
          versions.some(
            (v) => v.kitId === data.kitId && (v.version === data.version || v.status === 'draft'),
          )
        ) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = {
          id: id('ver'),
          status: 'draft',
          approvedBy: null,
          approvedAt: null,
          updatedAt: tick(),
          ...data,
        } as Row;
        versions.push(row);
        return { id: row.id, version: row.version };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = versions.filter((v) => versionMatch(v, where));
        rows.forEach((r) => Object.assign(r, data, { updatedAt: tick() }));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = versions.filter((v) => versionMatch(v, where));
        for (const r of rows) versions.splice(versions.indexOf(r), 1);
        return { count: rows.length };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        pick(users.find((u) => u.id === where.id)),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return {
    kits,
    versions,
    users,
    prisma,
    session: { role: 'architect' as string, userId: 'u-owner', username: 'owner' },
    reset() {
      kits.length = 0;
      versions.length = 0;
      users.length = 0;
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }));
vi.mock('@/lib/auth', () => ({
  requireApiRole: vi.fn(async (role: string | string[]) => {
    const allowed = Array.isArray(role) ? role : [role];
    if (!db.session.role) {
      return NextResponse.json({ error: 'Требуется вход в систему' }, { status: 401 });
    }
    if (!allowed.includes(db.session.role)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    return { ...db.session, exp: 0 };
  }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));

import { GET as LIST, POST as CREATE } from '@/app/api/solution-kits/route';
import { GET as GET_KIT, PATCH as PATCH_KIT } from '@/app/api/solution-kits/[kitId]/route';
import { POST as NEW_VERSION } from '@/app/api/solution-kits/[kitId]/versions/route';
import {
  DELETE as DELETE_VERSION,
  GET as GET_VERSION,
  PATCH as PATCH_VERSION,
} from '@/app/api/solution-kits/[kitId]/versions/[version]/route';
import { POST as APPROVE } from '@/app/api/solution-kits/[kitId]/versions/[version]/approve/route';
import { POST as ARCHIVE } from '@/app/api/solution-kits/[kitId]/versions/[version]/archive/route';
import { GET as DIFF } from '@/app/api/solution-kits/[kitId]/versions/[version]/diff/route';
import { POST as VALIDATE } from '@/app/api/solution-kits/validate/route';
import { writeAudit } from '@/lib/audit';

const req = (method: string, body?: unknown, url = 'http://localhost/x') =>
  new NextRequest(url, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  });
const kitProps = (kitId: string) => ({ params: Promise.resolve({ kitId }) });
const verProps = (kitId: string, version: string | number) => ({
  params: Promise.resolve({ kitId, version: String(version) }),
});

function as(role: string, userId = 'u-owner', username = 'owner') {
  db.session.role = role;
  db.session.userId = userId;
  db.session.username = username;
}

const content = {
  requirements: [
    {
      elementId: 'req-1',
      category: 'functional',
      title: 'Сбор',
      description: 'Система должна собирать события.',
    },
  ],
  checks: [{ elementId: 'chk-1', requirementIds: ['req-1'], criteria: 'События видны' }],
};

/** Утверждение как из UI: с updatedAt просмотренного черновика. */
async function approve(kitId: string, version: number, expected?: string) {
  const v = db.versions.find((x) => x.kitId === kitId && x.version === version);
  const expectedUpdatedAt = expected ?? (v?.updatedAt as Date | undefined)?.toISOString();
  return APPROVE(req('POST', { expectedUpdatedAt }), verProps(kitId, version));
}

async function createKit(key = 'siem.basic') {
  const res = await CREATE(req('POST', { key, name: 'SIEM базовый', content }));
  expect(res.status).toBe(201);
  return (await res.json()).kit.id as string;
}

describe('API библиотеки решений', () => {
  beforeEach(() => {
    db.reset();
    as('architect');
    vi.mocked(writeAudit).mockClear();
  });

  it('допуск: без входа 401, пресейл 403, архитектор и админ читают', async () => {
    as('');
    expect((await LIST()).status).toBe(401);
    as('presale');
    expect((await LIST()).status).toBe(403);
    expect((await CREATE(req('POST', { key: 'x.y', name: 'X' }))).status).toBe(403);
    expect((await VALIDATE(req('POST', { content: {} }))).status).toBe(403);
    as('architect');
    expect((await LIST()).status).toBe(200);
    as('admin');
    expect((await LIST()).status).toBe(200);
  });

  it('создание: создатель — владелец, черновик v1, ключ уникален и проверяется', async () => {
    const kitId = await createKit();
    expect(db.kits[0]).toMatchObject({ ownerId: 'u-owner', ownerName: 'owner', status: 'draft' });
    expect(db.versions[0]).toMatchObject({ kitId, version: 1, status: 'draft' });
    expect((await CREATE(req('POST', { key: 'siem.basic', name: 'Дубль' }))).status).toBe(409);
    expect((await CREATE(req('POST', { key: 'Bad Key', name: 'X' }))).status).toBe(400);
    const bad = await CREATE(req('POST', { key: 'bad.shape', name: 'X', content: { stages: 1 } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toBe('stages');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'solution_kit.create', entityId: kitId }),
    );
  });

  it('утверждение: чужой архитектор 403, владелец-архитектор утверждает', async () => {
    const kitId = await createKit();
    as('architect', 'u-other', 'other');
    expect((await approve(kitId, 1)).status).toBe(403);
    // чужой архитектор при этом правит черновик
    expect(
      (await PATCH_VERSION(req('PATCH', { changelog: 'правка' }), verProps(kitId, 1))).status,
    ).toBe(200);
    as('architect');
    const ok = await approve(kitId, 1);
    expect(ok.status).toBe(200);
    expect(db.versions[0]).toMatchObject({ status: 'approved', approvedBy: 'owner' });
    expect(db.kits[0].status).toBe('approved');
  });

  it('утверждение с висячей ссылкой — 409 с замечаниями; черновик при этом сохраняется', async () => {
    const kitId = await createKit();
    const broken = { ...content, requirements: [] };
    const saved = await PATCH_VERSION(req('PATCH', { content: broken }), verProps(kitId, 1));
    expect(saved.status).toBe(200);
    expect((await saved.json()).issues[0].code).toBe('dangling-ref');
    const res = await approve(kitId, 1);
    expect(res.status).toBe(409);
    expect((await res.json()).issues[0]).toMatchObject({
      code: 'dangling-ref',
      path: 'checks[0].requirementIds[0]',
    });
    expect(db.versions[0].status).toBe('draft');
  });

  it('утверждённая версия неизменна; новая версия копирует последнюю и не трогает старую', async () => {
    const kitId = await createKit();
    as('admin', 'u-admin', 'admin');
    expect((await approve(kitId, 1)).status).toBe(200);
    const v1Before = structuredClone(db.versions[0]);

    expect((await PATCH_VERSION(req('PATCH', { changelog: 'x' }), verProps(kitId, 1))).status).toBe(
      409,
    );
    expect((await DELETE_VERSION(req('DELETE'), verProps(kitId, 1))).status).toBe(409);
    expect((await approve(kitId, 1)).status).toBe(409);

    const created = await NEW_VERSION(req('POST'), kitProps(kitId));
    expect(created.status).toBe(201);
    expect((await created.json()).version.version).toBe(2);
    expect((await NEW_VERSION(req('POST'), kitProps(kitId))).status).toBe(409); // один черновик

    const v2 = await (await GET_VERSION(req('GET'), verProps(kitId, 2))).json();
    expect(v2.version.content.requirements[0].elementId).toBe('req-1');

    const changed = structuredClone(v2.version.content);
    changed.requirements[0].title = 'Сбор и нормализация';
    expect(
      (await PATCH_VERSION(req('PATCH', { content: changed }), verProps(kitId, 2))).status,
    ).toBe(200);
    // Журнал изменений обязателен со второй версии.
    expect((await approve(kitId, 2)).status).toBe(409);
    await PATCH_VERSION(req('PATCH', { changelog: 'Уточнено требование' }), verProps(kitId, 2));

    const diff = await (await DIFF(req('GET'), verProps(kitId, 2))).json();
    expect(diff.diff.sections.requirements.changed[0]).toMatchObject({
      elementId: 'req-1',
      fields: ['title'],
    });
    expect((await approve(kitId, 2)).status).toBe(200);
    expect(db.versions.find((v) => v.version === 1)).toEqual(v1Before);
  });

  it('архив версии: только утверждённую и только владелец/админ', async () => {
    const kitId = await createKit();
    expect((await ARCHIVE(req('POST'), verProps(kitId, 1))).status).toBe(409); // черновик
    await approve(kitId, 1);
    as('architect', 'u-other', 'other');
    expect((await ARCHIVE(req('POST'), verProps(kitId, 1))).status).toBe(403);
    as('architect');
    expect((await ARCHIVE(req('POST'), verProps(kitId, 1))).status).toBe(200);
    expect(db.versions[0]).toMatchObject({ status: 'archived', archivedBy: 'owner' });
    expect((await ARCHIVE(req('POST'), verProps(kitId, 1))).status).toBe(409);
  });

  it('паспорт и архив набора: владелец или админ; в архиве нельзя создать версию', async () => {
    const kitId = await createKit();
    as('architect', 'u-other', 'other');
    expect((await PATCH_KIT(req('PATCH', { name: 'Чужое' }), kitProps(kitId))).status).toBe(403);
    as('architect');
    expect((await PATCH_KIT(req('PATCH', { key: 'other.key' }), kitProps(kitId))).status).toBe(400);
    const res = await PATCH_KIT(
      req('PATCH', { scope: { industries: ['ИБ'] }, status: 'archived' }),
      kitProps(kitId),
    );
    expect(res.status).toBe(200);
    expect(db.kits[0]).toMatchObject({ status: 'archived' });
    await DELETE_VERSION(req('DELETE'), verProps(kitId, 1));
    expect((await NEW_VERSION(req('POST'), kitProps(kitId))).status).toBe(409);
    expect((await PATCH_KIT(req('PATCH', { status: 'active' }), kitProps(kitId))).status).toBe(200);
    expect(db.kits[0].status).toBe('draft');
  });

  it('системный набор (без владельца) утверждает только администратор', async () => {
    const kitId = await createKit();
    db.kits[0].ownerId = null;
    expect((await approve(kitId, 1)).status).toBe(403);
    as('admin', 'u-admin', 'admin');
    expect((await approve(kitId, 1)).status).toBe(200);
  });

  it('смена владельца: только на архитектора или админа', async () => {
    const kitId = await createKit();
    db.users.push(
      { id: 'u-p', username: 'presale', role: 'presale' },
      { id: 'u-a', username: 'arch2', role: 'architect' },
    );
    expect((await PATCH_KIT(req('PATCH', { ownerId: 'u-p' }), kitProps(kitId))).status).toBe(400);
    expect((await PATCH_KIT(req('PATCH', { ownerId: null }), kitProps(kitId))).status).toBe(403);
    expect((await PATCH_KIT(req('PATCH', { ownerId: 'u-a' }), kitProps(kitId))).status).toBe(200);
    expect(db.kits[0]).toMatchObject({ ownerId: 'u-a', ownerName: 'arch2' });
  });

  it('номер версии и 404', async () => {
    const kitId = await createKit();
    expect((await GET_VERSION(req('GET'), verProps(kitId, 'abc'))).status).toBe(400);
    expect((await GET_VERSION(req('GET'), verProps(kitId, 0))).status).toBe(400);
    expect((await GET_VERSION(req('GET'), verProps(kitId, 9))).status).toBe(404);
    expect((await GET_KIT(req('GET'), kitProps('nope'))).status).toBe(404);
    expect(
      (await DIFF(req('GET', undefined, 'http://localhost/x?against=7'), verProps(kitId, 1)))
        .status,
    ).toBe(404);
  });

  it('validate: форма, целостность и сводка без сохранения', async () => {
    const res = await VALIDATE(req('POST', { content }));
    expect(await res.json()).toMatchObject({
      valid: true,
      shapeIssues: [],
      issues: [],
      stats: { requirements: 1, checks: 1 },
    });
    const bad = await (
      await VALIDATE(req('POST', { content: { checks: [{ elementId: 'c', criteria: 'x' }] } }))
    ).json();
    expect(bad.valid).toBe(false);
    expect(bad.issues[0].code).toBe('check-without-requirement');
  });
  it('утверждение сверяет updatedAt просмотренного черновика', async () => {
    const kitId = await createKit();
    expect((await APPROVE(req('POST', {}), verProps(kitId, 1))).status).toBe(400);
    const seen = (db.versions[0].updatedAt as Date).toISOString();
    await PATCH_VERSION(req('PATCH', { changelog: 'правка после просмотра' }), verProps(kitId, 1));
    const stale = await approve(kitId, 1, seen);
    expect(stale.status).toBe(409);
    expect(db.versions[0].status).toBe('draft');
    expect((await approve(kitId, 1)).status).toBe(200);
  });

  it('черновик удаляет автор или управляющий набором, не чужой архитектор', async () => {
    const kitId = await createKit();
    await approve(kitId, 1);
    as('architect', 'u-author', 'author');
    expect((await NEW_VERSION(req('POST'), kitProps(kitId))).status).toBe(201);
    as('architect', 'u-other', 'other');
    expect((await DELETE_VERSION(req('DELETE'), verProps(kitId, 2))).status).toBe(403);
    as('architect');
    expect((await DELETE_VERSION(req('DELETE'), verProps(kitId, 2))).status).toBe(200);
    as('architect', 'u-author', 'author');
    await NEW_VERSION(req('POST'), kitProps(kitId));
    expect((await DELETE_VERSION(req('DELETE'), verProps(kitId, 2))).status).toBe(200);
  });

  it('архив единственной утверждённой версии возвращает набор в черновик', async () => {
    const kitId = await createKit();
    await approve(kitId, 1);
    expect(db.kits[0].status).toBe('approved');
    const res = await ARCHIVE(req('POST'), verProps(kitId, 1));
    expect(await res.json()).toMatchObject({ status: 'archived', kitStatus: 'draft' });
    expect(db.kits[0].status).toBe('draft');
  });

  it('ограничения размера: тело запроса 413, лишние ссылки — ошибка формы', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const res = await VALIDATE(req('POST', { content: { notes: big } }));
    expect(res.status).toBe(413);
    const noLength = new NextRequest('http://localhost/x', {
      method: 'POST',
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(JSON.stringify({ content: { notes: big } })));
          c.close();
        },
      }),
      // duplex обязателен для потокового тела в Node
      duplex: 'half',
    });
    expect((await VALIDATE(noLength)).status).toBe(413);
    const refs = Array.from({ length: 201 }, (_, i) => `req-${i}`);
    const many = await (
      await VALIDATE(
        req('POST', {
          content: { checks: [{ elementId: 'c', criteria: 'x', requirementIds: refs }] },
        }),
      )
    ).json();
    expect(many.shapeIssues[0]).toMatchObject({ path: 'checks[0].requirementIds' });
    expect((await VALIDATE(req('POST', [1]))).status).toBe(400);
  });
});
