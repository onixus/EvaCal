import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { contentDisposition, responseBody, safeFileName } from '@/lib/exportResponse';
import { prisma } from '@/lib/prisma';
import { loadSpecification } from '@/lib/specification/store';
import { SpecificationError } from '@/lib/specification/validation';
import { renderSpecificationXlsx } from '@/lib/specification/xlsx';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/** XLSX of a saved revision. Same gate as SPEC export: share tokens need the export scope. */
export async function GET(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['export']);
    if (access instanceof NextResponse) return access;
    const raw = req.nextUrl.searchParams.get('version');
    if (
      raw !== null &&
      (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)
    )
      throw new SpecificationError('Некорректная версия');
    const saved = await loadSpecification(id, raw === null ? undefined : Number(raw));
    if (!saved) throw new SpecificationError('Редакция не найдена', 404);
    const calculation = await prisma.calculation.findUnique({
      where: { id },
      select: { name: true, customer: true },
    });
    if (!calculation) throw new SpecificationError('Расчет не найден', 404);
    const buffer = renderSpecificationXlsx(saved.snapshot, {
      calculationName: calculation.name,
      customer: calculation.customer,
    });
    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'specification.export.xlsx',
      entityType: 'calculation',
      entityId: id,
      meta: { version: saved.snapshot.version, status: saved.snapshot.status },
      ip: clientIp(req),
    });
    return new NextResponse(responseBody(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition(
          `SPEC_${safeFileName(calculation.name)}_v${saved.snapshot.version}`,
          'xlsx',
        ),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    return handleApiError(
      error,
      'Не удалось выгрузить спецификацию',
      error instanceof SpecificationError ? error.statusCode : 500,
    );
  }
}
