import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { actualsWriteGate } from '@/lib/actualsData';
import {
  CSV_SOURCE,
  MANUAL_HOURS_MODES,
  type ManualHoursMode,
  type SyncMode,
} from '@/lib/actualsLedger';
import { isLedgerConflict } from '@/lib/actualsLedgerData';
import { importActualsCsv } from '@/lib/actualsCsvImport';

const MAX_CSV_BYTES = 256 * 1024;

/**
 * CSV-импорт факта через журнал (#103 WP-6a). Формат — `этап;часы[;начало;
 * окончание]` или CSV с заголовком (id, задача, этап, часы, дата, автор…).
 * Тело — text/plain или JSON `{ csv, dryRun, mode, mappings }`:
 * - `dryRun` — сопоставление и план (новые/исправленные/без изменений/удаляемые)
 *   без записи;
 * - `mode: 'full'` — файл считается полной выгрузкой: записи CSV по расчёту,
 *   которых в нём нет, помечаются удалёнными; по умолчанию `incremental`;
 * - `mappings` — `{ ключ задачи: stageId }`, сохраняются при применении;
 * - `manualHours: 'auto' | 'replace' | 'add'` — как обойтись с ручными часами
 *   этапов (в т.ч. перенесёнными миграцией): `auto` заменяет их для строк-итогов
 *   этапа (без id/даты/автора) и добавляет к ним worklog.
 * Повторный импорт того же файла ничего не меняет (upsert по externalId).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const params = await props.params;
  const gate = await actualsWriteGate(params.id, auth.role);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let csv = '';
  let dryRun = false;
  let mode: SyncMode = 'incremental';
  let mappings: Record<string, string> = {};
  let manualHours: ManualHoursMode = 'auto';
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    csv = String(body.csv ?? '');
    dryRun = Boolean(body.dryRun);
    if (body.mode !== undefined && body.mode !== 'incremental' && body.mode !== 'full') {
      return NextResponse.json({ error: 'mode: incremental или full' }, { status: 400 });
    }
    mode = body.mode ?? 'incremental';
    if (body.manualHours !== undefined) {
      if (!MANUAL_HOURS_MODES.includes(body.manualHours)) {
        return NextResponse.json({ error: 'manualHours: auto, replace или add' }, { status: 400 });
      }
      manualHours = body.manualHours;
    }
    if (body.mappings && typeof body.mappings === 'object') {
      mappings = Object.fromEntries(
        Object.entries(body.mappings as Record<string, unknown>)
          .filter(([k, v]) => k.trim() && typeof v === 'string' && v)
          .map(([k, v]) => [k.trim().slice(0, 200), v as string]),
      );
    }
  } else {
    csv = await req.text();
    dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    if (req.nextUrl.searchParams.get('mode') === 'full') mode = 'full';
    const mh = req.nextUrl.searchParams.get('manualHours');
    if (mh && (MANUAL_HOURS_MODES as readonly string[]).includes(mh)) {
      manualHours = mh as ManualHoursMode;
    }
  }
  if (Buffer.byteLength(csv) > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV больше 256 КБ' }, { status: 413 });
  }

  let imported: Awaited<ReturnType<typeof importActualsCsv>>;
  try {
    imported = await importActualsCsv({
      calculationId: params.id,
      csv,
      mode,
      manualHours,
      mappings,
      startedBy: auth.userId,
      dryRun,
    });
  } catch (e) {
    if (isLedgerConflict(e)) {
      return NextResponse.json(
        { error: 'Факт по расчёту меняется параллельно — повторите импорт' },
        { status: 409 },
      );
    }
    throw e;
  }
  if (!imported.ok) return NextResponse.json({ error: imported.error }, { status: 400 });
  const { sync, report } = imported;

  if (!dryRun) {
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'actuals.import',
      entityType: 'calculation',
      entityId: params.id,
      meta: {
        source: CSV_SOURCE,
        mode,
        manualHours,
        ...sync.counts,
        matched: report.matched.length,
        unmatched: report.unmatched.length,
        invalid: report.invalid.length,
        manualReset: sync.manualResetStageIds.length,
        runId: sync.runId,
      },
      ip: clientIp(req),
    });
  }

  return NextResponse.json(report);
}
