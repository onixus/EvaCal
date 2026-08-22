import { requireRole } from '@/lib/auth';
import AuthBar from '@/components/AuthBar';

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(['architect', 'admin'], '/projects');
  return (
    <div>
      <AuthBar
        username={session.username}
        roleLabel={session.role === 'admin' ? 'администратор' : 'архитектор'}
      />
      {children}
    </div>
  );
}
