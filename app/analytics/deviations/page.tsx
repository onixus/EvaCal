import { requireRole } from '@/lib/auth';
import { listSavedReports, loadDeviationCatalog } from '@/lib/deviationsData';
import DeviationBuilder from './DeviationBuilder';

export const dynamic = 'force-dynamic';

/** Конструктор срезов и отчётов по отклонениям (E3). */
export default async function DeviationBuilderPage() {
  const session = await requireRole(
    ['presale', 'architect', 'reviewer', 'admin'],
    '/analytics/deviations',
  );
  const [catalog, saved] = await Promise.all([loadDeviationCatalog(), listSavedReports()]);
  return (
    <DeviationBuilder
      catalog={catalog}
      saved={saved}
      viewer={{ id: session.userId, role: session.role }}
    />
  );
}
