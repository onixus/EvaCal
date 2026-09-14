import { requireRole } from '@/lib/auth';
import { loadCapacityMatrix, DEFAULT_WEEKS } from '@/lib/capacityData';
import CapacityClient from './CapacityClient';

export const dynamic = 'force-dynamic';

/** Ресурсный план по портфелю (Horizon E2). */
export default async function CapacityPage(props: {
  searchParams: Promise<{ weeks?: string; drafts?: string }>;
}) {
  const session = await requireRole(
    ['architect', 'gap', 'techwriter', 'reviewer', 'admin'],
    '/capacity',
  );
  const sp = await props.searchParams;
  const weeks = sp.weeks === '26' ? 26 : DEFAULT_WEEKS;
  const includeDrafts = sp.drafts === '1';
  const matrix = await loadCapacityMatrix({ weeks, includeDrafts });
  return (
    <CapacityClient
      initial={matrix}
      weeks={weeks}
      includeDrafts={includeDrafts}
      canWhatIf={session.role !== 'reviewer'}
    />
  );
}
