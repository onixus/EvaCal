import { requireRole } from '@/lib/auth';
import { PROJECT_VIEWER_ROLES } from '@/lib/appRoles';

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  // Пресейл заводит проекты и версии смет, поэтому реестр открыт и ему —
  // раньше пункт «Проекты» был в его навигации, а экран разворачивал на логин.
  await requireRole(PROJECT_VIEWER_ROLES, '/projects');
  return <>{children}</>;
}
