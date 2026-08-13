import { NextRequest, NextResponse } from 'next/server';
import { buildTraceability } from '@/lib/gost34/traceability/engine';
import { Gost34RequirementV2 } from '@/lib/gost34/requirements/v2';
import { Gost34StageItem } from '@/lib/gost34/types';
import { TraceLink } from '@/lib/gost34/traceability/types';
import { requireStaff } from '@/lib/access';

/** Pure compute endpoint: staff-only (payload may contain commercial stages). */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireStaff();
    if (auth instanceof NextResponse) return auth;

    const body = await req.json();
    const requirements: Gost34RequirementV2[] = body.requirements;
    const stages: Gost34StageItem[] = body.stages;
    const manualLinks: TraceLink[] = body.manualLinks || [];

    if (!requirements || !Array.isArray(requirements)) {
      return NextResponse.json({ error: 'Valid requirements array is required' }, { status: 400 });
    }
    if (!stages || !Array.isArray(stages)) {
      return NextResponse.json({ error: 'Valid stages array is required' }, { status: 400 });
    }

    const result = buildTraceability(requirements, stages, manualLinks);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
