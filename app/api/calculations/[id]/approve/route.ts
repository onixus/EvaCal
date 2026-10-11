import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { loadCommercialState, withCommercialLock } from '@/lib/commercialContourData';
import type { MarginGate } from '@/lib/discountApproval';

type Outcome =
  | { kind: 'not_found' }
  | { kind: 'blocked'; gate: MarginGate }
  | { kind: 'conflict' }
  | {
      kind: 'ok';
      calculation: unknown;
      gate: MarginGate;
      minMarginPercent: number | null;
    };

// Architect signs off on the presale calculation.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;

  // #103 §4.3: маржа КП ниже порога (или не определена) — утверждение только
  // при согласованной скидке с тем же отпечатком условий. Проверка и запись —
  // в одной транзакции под блокировкой расчёта; строка обновляется, только если
  // её updatedAt не изменился после чтения условий.
  const outcome = await withCommercialLock<Outcome>(params.id, async (tx) => {
    const state = await loadCommercialState(params.id, tx);
    if (!state) return { kind: 'not_found' };
    if (state.gate.requiresApproval && !state.gate.approved) {
      return { kind: 'blocked', gate: state.gate };
    }
    const updated = await tx.calculation.updateMany({
      where: { id: params.id, updatedAt: new Date(state.updatedAt) },
      data: { status: 'approved', stageEnteredAt: new Date() },
    });
    if (updated.count === 0) return { kind: 'conflict' };
    return {
      kind: 'ok',
      calculation: await tx.calculation.findUnique({ where: { id: params.id } }),
      gate: state.gate,
      minMarginPercent: state.minMarginPercent,
    };
  });

  if (outcome.kind === 'not_found') {
    return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 });
  }
  if (outcome.kind === 'blocked') {
    return NextResponse.json({ error: outcome.gate.message, gate: outcome.gate }, { status: 409 });
  }
  if (outcome.kind === 'conflict') {
    return NextResponse.json(
      { error: 'Расчёт изменился во время утверждения — проверьте КП и повторите' },
      { status: 409 },
    );
  }

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
      margin: outcome.gate.margin,
      minMarginPercent: outcome.minMarginPercent,
      discountApprovalId: outcome.gate.approvalId,
    },
    ip: clientIp(req),
  });

  return NextResponse.json(outcome.calculation);
}
