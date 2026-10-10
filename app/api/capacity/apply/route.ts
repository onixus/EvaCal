import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadCalcPlans, rescheduleOps } from '@/lib/planningData';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Применить сдвиги what-if к датам старта (E2). Отдельный маршрут, а не PATCH
 * расчёта: тот отказывает утверждённым версиям, а перенос сроков выигранного
 * проекта — штатная операция планирования и не меняет ни объём, ни смету.
 * Каждый сдвиг применяется независимо; ответ говорит, что применилось, а что
 * нет, чтобы клиент не повторял уже записанные сдвиги.
 *
 * Новый старт = старый + shiftDays календарных дней; Гант перестраивается на
 * месте по производственному календарю шаблона и явным зависимостям этапов
 * (#103 WP-5e) — праздник в новом окне удлиняет этап так же, как в what-if.
 * id строк сохраняются: перестройка этапов (rebuildStages) пересоздала бы
 * строки и стёрла бы внесённый факт.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const shifts: { calculationId: string; shiftDays: number }[] = Array.isArray(body.shifts)
      ? body.shifts
          .map((s: { calculationId?: unknown; shiftDays?: unknown }) => ({
            calculationId: String(s.calculationId ?? ''),
            shiftDays: Math.round(Number(s.shiftDays) || 0),
          }))
          .filter(
            (s: { calculationId: string; shiftDays: number }) =>
              s.calculationId && s.shiftDays !== 0 && Math.abs(s.shiftDays) <= 365,
          )
      : [];
    if (shifts.length === 0) return NextResponse.json({ error: 'Нет сдвигов' }, { status: 400 });

    const applied: { calculationId: string; name: string; startDate: string }[] = [];
    const failed: { calculationId: string; name: string; error: string }[] = [];

    for (const s of shifts) {
      const calc = await prisma.calculation.findUnique({
        where: { id: s.calculationId },
        include: {
          project: { select: { dealStatus: true, status: true, actualsClosedAt: true } },
        },
      });
      if (!calc) {
        failed.push({
          calculationId: s.calculationId,
          name: s.calculationId,
          error: 'расчёт не найден',
        });
        continue;
      }
      if (calc.project?.actualsClosedAt) {
        failed.push({ calculationId: calc.id, name: calc.name, error: 'факт по проекту закрыт' });
        continue;
      }
      if (
        calc.project?.dealStatus === 'lost' ||
        calc.project?.dealStatus === 'cancelled' ||
        calc.project?.status === 'archived'
      ) {
        failed.push({
          calculationId: calc.id,
          name: calc.name,
          error: 'сделка закрыта или проект в архиве',
        });
        continue;
      }
      const startDate = new Date(calc.startDate.getTime() + s.shiftDays * DAY_MS);
      try {
        const plan = (await loadCalcPlans([calc.id])).get(calc.id);
        if (!plan) throw new Error('расчёт не найден');
        await prisma.$transaction(rescheduleOps(plan, startDate));
        await writeAudit({
          actorType: 'user',
          actorId: auth.userId,
          action: 'calculation.shift',
          entityType: 'calculation',
          entityId: calc.id,
          meta: { shiftDays: s.shiftDays, startDate: startDate.toISOString() },
          ip: clientIp(req),
        });
        applied.push({
          calculationId: calc.id,
          name: calc.name,
          startDate: startDate.toISOString(),
        });
      } catch (err) {
        failed.push({
          calculationId: calc.id,
          name: calc.name,
          error: err instanceof Error ? err.message : 'ошибка',
        });
      }
    }
    return NextResponse.json({ applied, failed });
  } catch (err) {
    return handleApiError(err, 'Failed to apply shifts');
  }
}
