import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { CommercialContourError, decimalString } from '@/lib/commercialContourData';
import {
  COMMERCIAL_VIEW_ROLES,
  EXCHANGE_RATE_EDIT_ROLES,
  contourError,
} from '@/lib/commercialContourHttp';
import { RATE_RE } from '@/lib/specification/validation';

const CODE = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function serialize(r: {
  id: string;
  from: string;
  to: string;
  rate: { toFixed: () => string };
  date: Date;
  source: string;
  createdBy: string;
  createdAt: Date;
}) {
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    rate: decimalString(r.rate),
    date: r.date.toISOString().slice(0, 10),
    source: r.source,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Справочник курсов (#101 §3). `?from=USD&to=RUB&date=2026-10-01` — последний
 * курс пары на дату (не позже неё); без даты — история пары; без пары — 200
 * последних записей. Курс не подбирается обратным или кросс-курсом.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(COMMERCIAL_VIEW_ROLES);
  if (auth instanceof NextResponse) return auth;
  const q = new URL(req.url).searchParams;
  const from = q.get('from')?.trim().toUpperCase() ?? '';
  const to = q.get('to')?.trim().toUpperCase() ?? '';
  const date = q.get('date')?.trim() ?? '';
  try {
    if ((from || to) && (!CODE.test(from) || !CODE.test(to)))
      throw new CommercialContourError('Пара валют: from и to — коды из 3 букв');
    if (date && !DATE.test(date)) throw new CommercialContourError('Дата: ГГГГ-ММ-ДД');
    const rows = await prisma.exchangeRate.findMany({
      where: {
        ...(from ? { from, to } : {}),
        ...(date ? { date: { lte: new Date(`${date}T00:00:00Z`) } } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: date && from ? 1 : 200,
    });
    return NextResponse.json({ rates: rows.map(serialize) });
  } catch (error) {
    return contourError(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(EXCHANGE_RATE_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const from = typeof b.from === 'string' ? b.from.trim().toUpperCase() : '';
    const to = typeof b.to === 'string' ? b.to.trim().toUpperCase() : '';
    if (!CODE.test(from) || !CODE.test(to) || from === to)
      throw new CommercialContourError('Пара валют: две разные валюты, коды из 3 букв');
    if (typeof b.rate !== 'string' || !RATE_RE.test(b.rate) || !/[1-9]/.test(b.rate))
      throw new CommercialContourError(
        'Курс: положительное число строкой, до 8 знаков после точки',
      );
    const date = typeof b.date === 'string' ? b.date.trim() : '';
    if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      throw new CommercialContourError('Дата курса: ГГГГ-ММ-ДД');
    const source = typeof b.source === 'string' ? b.source.trim().slice(0, 200) : '';
    if (!source) throw new CommercialContourError('Укажите источник курса');
    const exists = await prisma.exchangeRate.findUnique({
      where: { from_to_date_source: { from, to, date: new Date(`${date}T00:00:00Z`), source } },
    });
    if (exists)
      throw new CommercialContourError(
        'Курс на эту дату из этого источника уже записан; история курсов не перезаписывается',
        409,
      );
    const created = await prisma.exchangeRate.create({
      data: {
        from,
        to,
        rate: b.rate,
        date: new Date(`${date}T00:00:00Z`),
        source,
        createdBy: auth.username,
      },
    });
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'exchange_rate.create',
      entityType: 'exchange_rate',
      entityId: created.id,
      meta: { from, to, rate: b.rate, date, source },
      ip: clientIp(req),
    });
    return NextResponse.json(serialize(created), { status: 201 });
  } catch (error) {
    return contourError(error);
  }
}
