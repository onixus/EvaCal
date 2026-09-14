import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Применить сдвиги what-if к датам старта (E2). Отдельный маршрут, а не PATCH
 * расчёта: тот отказывает утверждённым версиям, а перенос сроков выигранного
 * проекта — штатная операция планирования и не меняет ни объём, ни смету.
 * Каждый сдвиг применяется независимо; ответ говорит, что применилось, а что
 * нет, чтобы клиент не повторял уже записанные сдвиги.
 *
 * Даты этапов переносятся на то же число дней с сохранением id: перестройка
 * этапов (rebuildStages) пересоздала бы строки и стёрла бы внесённый факт.
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
          stages: { select: { id: true, startDate: true, endDate: true, dueDate: true } },
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
      const move = (d: Date | null) => (d ? new Date(d.getTime() + s.shiftDays * DAY_MS) : null);
      try {
        await prisma.$transaction([
          prisma.calculation.update({ where: { id: calc.id }, data: { startDate } }),
          ...calc.stages.map((st) =>
            prisma.stage.update({
              where: { id: st.id },
              data: {
                startDate: move(st.startDate) as Date,
                endDate: move(st.endDate) as Date,
                dueDate: move(st.dueDate),
              },
            }),
          ),
        ]);
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
