import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';

// Architect signs off on the presale calculation.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;

  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: { status: 'approved', stageEnteredAt: new Date() },
  });

  // Кто согласовал — иначе вклад архитектора в рейтинг (/leaderboard) не виден:
  // сам расчёт хранит только автора-пресейла.
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calculation.approve',
    entityType: 'calculation',
    entityId: params.id,
    meta: { username: auth.username },
    ip: clientIp(req),
  });

  return NextResponse.json(calculation);
}
