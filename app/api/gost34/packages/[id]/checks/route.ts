import { NextRequest, NextResponse } from 'next/server';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadPackageForRead, loadPackageForWrite } from '@/lib/acceptance/http';
import { canRecordAcceptance, isPackageEligibleForChecks } from '@/lib/acceptance/rules';
import { countPendingSeeds, listChecks, seedChecks, summarize } from '@/lib/acceptance/store';
import type { ChecksResponse } from '@/lib/acceptance/types';

type Props = { params: Promise<{ id: string }> };

/** Проверки приёмки редакции комплекта: состояние, история, замечания. */
export async function GET(req: NextRequest, props: Props) {
  try {
    const { id } = await props.params;
    const loaded = await loadPackageForRead(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const { pkg, access, actor } = loaded;
    const eligible = isPackageEligibleForChecks(pkg);
    const checks = await listChecks(pkg.id);
    const body: ChecksResponse = {
      packageId: pkg.id,
      packageVersion: pkg.version,
      eligible,
      canRecord: eligible && access.kind === 'staff' && canRecordAcceptance(actor.role),
      pendingSeeds: eligible ? await countPendingSeeds(pkg) : 0,
      checks,
      summary: summarize(checks),
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleApiError(err, 'Failed to load acceptance checks', 500);
  }
}

/**
 * Сформировать проверки из требований снимка утверждённой редакции. Повторный
 * вызов добавляет только недостающие и не меняет заведённые проверки.
 */
export async function POST(req: NextRequest, props: Props) {
  try {
    const { id } = await props.params;
    const loaded = await loadPackageForWrite(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const { pkg, access, actor } = loaded;
    const { created, total } = await seedChecks(pkg, actor.name);
    if (total === 0) {
      return NextResponse.json(
        {
          error:
            'В снимке комплекта нет требований с критерием приёмки или методом проверки — проверки не из чего сформировать',
        },
        { status: 422 },
      );
    }
    if (created > 0) {
      await writeAudit({
        actorType: actorTypeFromAccess(access.kind),
        actorId: actor.id,
        action: 'acceptance_check.seed',
        entityType: 'gost_package',
        entityId: pkg.id,
        meta: { created, total },
        ip: clientIp(req),
      });
    }
    return NextResponse.json({ created, total }, { status: created > 0 ? 201 : 200 });
  } catch (err) {
    return handleApiError(err, 'Failed to seed acceptance checks', 500);
  }
}
