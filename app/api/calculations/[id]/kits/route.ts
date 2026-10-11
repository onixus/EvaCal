import { NextRequest, NextResponse } from 'next/server';
import { requireKitApplicationRole, kitFailure } from '@/lib/kitApplication/http';
import { kitUpdateProposals, listKitApplications } from '@/lib/kitApplication/store';

type Params = { params: Promise<{ id: string }> };

/**
 * Наборы решений расчёта (#103 WP-7b): журнал применений и предложения
 * обновлений (элементы проекта против последней утверждённой версии набора).
 */
export async function GET(_req: NextRequest, props: Params) {
  const auth = await requireKitApplicationRole();
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  const proposals = await kitUpdateProposals(id);
  if (!proposals.ok) return kitFailure(proposals);
  const applications = await listKitApplications(id);
  return NextResponse.json({ applications, proposals: proposals.proposals });
}
