import { requireRole } from '@/lib/auth';

/**
 * Шаблоны, пользователи, календари и ёмкость — только администратор.
 * Группа маршрутов `(core)` не влияет на URL: она отделяет эти экраны от
 * `/admin/solution-kits`, куда допущен и архитектор (docs/solution-library.md).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin', '/admin');
  return <>{children}</>;
}
