import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/access';
import AgentsManager from './AgentsManager';
import PageHeader from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

/** Реестр харнесс-агентов: доступен архитектору/ГИПу и админу. */
export default async function AgentsPage() {
  const session = await getStaffSession();
  if (!session) redirect('/login');

  return (
    <div className="page">
      <PageHeader
        title="Харнесс-агенты"
        description="Подключайте собственные агенты ревью и обогащения комплектов ГОСТ 34: платформа вызывает их по HTTP и показывает находки, ничего не меняя без вашего подтверждения."
      />
      <AgentsManager isAdmin={session.role === 'admin'} />
    </div>
  );
}
