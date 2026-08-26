import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/access';
import AgentsManager from './AgentsManager';

export const dynamic = 'force-dynamic';

/** Реестр харнесс-агентов: доступен архитектору/ГИПу и админу. */
export default async function AgentsPage() {
  const session = await getStaffSession();
  if (!session) redirect('/login');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Харнесс-агенты</h1>
        <p className="text-sm text-slate-500">
          Подключайте собственные агенты ревью и обогащения комплектов ГОСТ 34: платформа вызывает
          их по HTTP и показывает находки, ничего не меняя без вашего подтверждения.
        </p>
      </div>
      <AgentsManager isAdmin={session.role === 'admin'} />
    </div>
  );
}
