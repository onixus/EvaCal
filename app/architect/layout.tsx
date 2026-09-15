import { requireRole } from '@/lib/auth';

export default async function ArchitectLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['architect', 'admin'], '/architect');
  return <>{children}</>;
}
