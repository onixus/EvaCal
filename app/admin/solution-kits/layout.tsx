import { requireRole } from '@/lib/auth';
import { KIT_LIBRARY_ROLES } from '@/lib/solutionKits/rules';

/** Библиотека решений (#103 WP-7a): архитектор и администратор. */
export default async function SolutionKitsLayout({ children }: { children: React.ReactNode }) {
  await requireRole([...KIT_LIBRARY_ROLES], '/admin/solution-kits');
  return <>{children}</>;
}
