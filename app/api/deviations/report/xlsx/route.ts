import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { runDeviationReport } from '@/lib/deviationsData';
import { GROUP_LABELS } from '@/lib/deviations';
import { safeJsonParse } from '@/lib/json';
import { renderDeviationReportXlsx } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';

/**
 * Выгрузка среза. Принимает JSON `{ config }` или form-data с полем `config`
 * (JSON-строка) — так браузер получает файл обычным сабмитом формы.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['presale', 'architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const ct = req.headers.get('content-type') ?? '';
    let config: unknown;
    if (ct.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      config = body.config ?? body;
    } else {
      const form = await req.formData();
      config = safeJsonParse(String(form.get('config') ?? ''), {});
    }
    const result = await runDeviationReport(config);
    const buf = renderDeviationReportXlsx(result, GROUP_LABELS[result.config.groupBy]);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="deviations-${result.config.groupBy}.xlsx"`,
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to export deviation report');
  }
}
