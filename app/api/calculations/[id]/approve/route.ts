import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { loadCommercialState } from '@/lib/commercialContourData';

// Architect signs off on the presale calculation.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;

  // #103 §4.3: маржа КП ниже порога (или не определена) — утверждение только
  // при согласованной скидке, соответствующей текущим условиям.
  const state = await loadCommercialState(params.id);
  if (!state) return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 });
  if (state.gate.requiresApproval && !state.gate.approved) {
    return NextResponse.json({ error: state.gate.message, gate: state.gate }, { status: 409 });
  }

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
    meta: {
      username: auth.username,
      margin: state.gate.margin,
      minMarginPercent: state.minMarginPercent,
      discountApprovalId: state.gate.approvalId,
    },
    ip: clientIp(req),
  });

  return NextResponse.json(calculation);
}
