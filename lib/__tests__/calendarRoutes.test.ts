import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST as createCalendar } from '@/app/api/admin/calendars/route';
import {
  PATCH as patchCalendar,
  DELETE as deleteCalendar,
} from '@/app/api/admin/calendars/[id]/route';
import { POST as addExceptions } from '@/app/api/admin/calendars/[id]/exceptions/route';
import { POST as createReservation } from '@/app/api/admin/reservations/route';
import { parseExceptionLines, parseReservationInput } from '@/lib/calendarAdmin';

vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/prisma', () => {
  const workCalendar = {
    count: vi.fn(),
    create: vi.fn(async ({ data }) => ({ id: 'cal-new', ...data })),
    findUnique: vi.fn(),
    update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    updateMany: vi.fn(),
    delete: vi.fn(),
  };
  const calendarException = {
    upsert: vi.fn(async ({ create }) => ({ id: 'ex', ...create })),
    findUnique: vi.fn(),
    delete: vi.fn(),
  };
  const roleReservation = { create: vi.fn(async ({ data }) => ({ id: 'r1', ...data })) };
  const client = { workCalendar, calendarException, roleReservation };
  return {
    prisma: {
      ...client,
      $transaction: vi.fn(async (arg: unknown) =>
        typeof arg === 'function' ? arg(client) : Promise.all(arg as Promise<unknown>[]),
      ),
    },
  };
});

import { requireApiRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const session = (role: string) => ({ userId: 'u1', username: 'x', role, exp: 0 });
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('календари: маршруты админки', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireApiRole).mockResolvedValue(session('admin'));
  });

  it('пишет только админ', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }));
    expect((await createCalendar(req('/api/admin/calendars', 'POST', { name: 'A' }))).status).toBe(
      403,
    );
    expect(prisma.workCalendar.create).not.toHaveBeenCalled();
    expect(vi.mocked(requireApiRole).mock.calls[0][0]).toEqual(['admin']);
  });

  it('новый основной календарь снимает признак с остальных — основной всегда один', async () => {
    vi.mocked(prisma.workCalendar.count).mockResolvedValue(2);
    const res = await createCalendar(
      req('/api/admin/calendars', 'POST', { name: 'Филиал', weekendDays: '7,6', isDefault: true }),
    );
    expect(res.status).toBe(201);
    expect(prisma.workCalendar.updateMany).toHaveBeenCalledWith({ data: { isDefault: false } });
    expect(vi.mocked(prisma.workCalendar.create).mock.calls[0][0].data).toMatchObject({
      isDefault: true,
      weekendDays: '6,7',
    });
  });

  it('все семь дней выходными и пустое имя отклоняются', async () => {
    expect(
      (
        await createCalendar(
          req('/api/admin/calendars', 'POST', { name: 'A', weekendDays: '1,2,3,4,5,6,7' }),
        )
      ).status,
    ).toBe(400);
    expect((await createCalendar(req('/api/admin/calendars', 'POST', { name: ' ' }))).status).toBe(
      400,
    );
  });

  it('основной календарь нельзя разжаловать или удалить', async () => {
    vi.mocked(prisma.workCalendar.findUnique).mockResolvedValue({
      id: 'c1',
      isDefault: true,
      name: 'Основной',
    } as never);
    expect(
      (
        await patchCalendar(
          req('/api/admin/calendars/c1', 'PATCH', { isDefault: false }),
          params('c1'),
        )
      ).status,
    ).toBe(409);
    expect(
      (await deleteCalendar(req('/api/admin/calendars/c1', 'DELETE'), params('c1'))).status,
    ).toBe(409);
    expect(prisma.workCalendar.delete).not.toHaveBeenCalled();
  });

  it('назначение основным снимает признак с других в той же транзакции', async () => {
    vi.mocked(prisma.workCalendar.findUnique).mockResolvedValue({
      id: 'c2',
      isDefault: false,
      name: 'Филиал',
    } as never);
    const res = await patchCalendar(
      req('/api/admin/calendars/c2', 'PATCH', { isDefault: true }),
      params('c2'),
    );
    expect(res.status).toBe(200);
    expect(prisma.workCalendar.updateMany).toHaveBeenCalledWith({
      where: { NOT: { id: 'c2' } },
      data: { isDefault: false },
    });
  });

  it('исключения списком сохраняются upsert по дате', async () => {
    vi.mocked(prisma.workCalendar.findUnique).mockResolvedValue({ id: 'c1' } as never);
    const res = await addExceptions(
      req('/api/admin/calendars/c1/exceptions', 'POST', {
        lines:
          '# праздники\n2027-01-01 праздник Новый год\n2027-02-20 короткий 7\n2027-11-06 рабочий',
      }),
      params('c1'),
    );
    expect(res.status).toBe(201);
    expect(prisma.calendarException.upsert).toHaveBeenCalledTimes(3);
    const second = vi.mocked(prisma.calendarException.upsert).mock.calls[1][0];
    expect(second.where).toEqual({
      calendarId_date: { calendarId: 'c1', date: new Date('2027-02-20T00:00:00Z') },
    });
    expect(second.create).toMatchObject({ kind: 'short', hours: 7 });
  });

  it('некорректная дата исключения — 400 без записи', async () => {
    const res = await addExceptions(
      req('/api/admin/calendars/c1/exceptions', 'POST', { date: '2027-02-30', kind: 'holiday' }),
      params('c1'),
    );
    expect(res.status).toBe(400);
    expect(prisma.calendarException.upsert).not.toHaveBeenCalled();
  });

  it('резерв: роль заказчика, перевёрнутый период и пустая причина отклоняются', async () => {
    const ok = {
      role: 'engineer',
      from: '2027-01-11',
      to: '2027-01-24',
      hoursPerWeek: 12,
      reason: 'Отпуск',
    };
    expect((await createReservation(req('/api/admin/reservations', 'POST', ok))).status).toBe(201);
    expect(vi.mocked(prisma.roleReservation.create).mock.calls[0][0].data).toMatchObject({
      role: 'engineer',
      createdBy: 'u1',
      from: new Date('2027-01-11T00:00:00Z'),
    });
    expect(parseReservationInput({ ...ok, role: 'customer' }).ok).toBe(false);
    expect(parseReservationInput({ ...ok, to: '2027-01-01' }).ok).toBe(false);
    expect(parseReservationInput({ ...ok, reason: '' }).ok).toBe(false);
    expect(parseReservationInput({ ...ok, hoursPerWeek: 0 }).ok).toBe(false);
  });

  it('разбор списка сообщает номер строки с ошибкой', () => {
    const r = parseExceptionLines('2027-01-01 праздник\n2027-13-01 праздник');
    expect(r).toEqual({ ok: false, error: 'Строка 2: Дата в формате ГГГГ-ММ-ДД' });
    expect(parseExceptionLines('2027-02-20 короткий 9').ok).toBe(false);
  });
});
