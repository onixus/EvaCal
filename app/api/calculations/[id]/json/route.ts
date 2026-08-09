import { NextRequest, NextResponse } from 'next/server';
import { loadCalculationForExport, safeFileName, contentDisposition } from '@/lib/export';
import { totalLaborHours } from '@/lib/scheduling';
import { risksTotalHours } from '@/lib/totals';

// Same visibility as the rest of the archive: no auth required to export a calculation.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const calc = await loadCalculationForExport(params.id);
  if (!calc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const stagesHours = totalLaborHours(calc.stages);
  const risksHours = risksTotalHours(calc.risks);

  const payload = {
    name: calc.name,
    customer: calc.customer,
    status: calc.status,
    startDate: calc.startDate,
    template: calc.templateName,
    answers: calc.answers,
    stages: calc.stages,
    risks: calc.risks,
    totals: {
      stagesHours,
      pmHours: calc.pmHours,
      risksHours,
      grandTotal: stagesHours + calc.pmHours + risksHours,
    },
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': contentDisposition(safeFileName(calc.name), 'json'),
    },
  });
}
