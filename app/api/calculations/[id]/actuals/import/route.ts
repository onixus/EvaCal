import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { matchActuals, parseActualsCsv } from '@/lib/actuals';
import { actualsWriteGate } from '@/lib/actualsData';

const MAX_CSV_BYTES = 256 * 1024;

/**
 * CSV-импорт факта: `этап;часы[;начало;окончание]`. Тело — text/plain или
 * JSON `{ csv, dryRun }`. `dryRun` возвращает сопоставление без записи, чтобы
 * показать несовпавшие строки до применения.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const params = await props.params;
  const gate = await actualsWriteGate(params.id, auth.role);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let csv = '';
  let dryRun = false;
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    csv = String(body.csv ?? '');
    dryRun = Boolean(body.dryRun);
  } else {
    csv = await req.text();
    dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
  }
  if (Buffer.byteLength(csv) > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV больше 256 КБ' }, { status: 413 });
  }

  const stages = await prisma.stage.findMany({
    where: { calculationId: params.id },
    select: { id: true, name: true, isApprovalTask: true },
  });
  const parsed = parseActualsCsv(csv);
  const result = matchActuals(parsed.rows, stages, parsed.invalid);

  if (!dryRun) {
    for (const m of result.matched) {
      const start = m.start ? new Date(m.start) : undefined;
      const end = m.end ? new Date(m.end) : undefined;
      await prisma.stage.update({
        where: { id: m.stageId },
        data: {
          actualHours: m.hours,
          ...(start && !Number.isNaN(start.getTime()) ? { actualStartDate: start } : {}),
          ...(end && !Number.isNaN(end.getTime()) ? { actualEndDate: end } : {}),
        },
      });
    }
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'actuals.import',
      entityType: 'calculation',
      entityId: params.id,
      meta: {
        matched: result.matched.length,
        unmatched: result.unmatched.length,
        invalid: result.invalid.length,
      },
      ip: clientIp(req),
    });
  }

  return NextResponse.json({ ...result, applied: !dryRun });
}
