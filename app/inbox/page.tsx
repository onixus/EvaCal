import { requireRole } from '@/lib/auth';
import PageHeader from '@/components/PageHeader';
import { loadMyQueue } from '@/lib/review/queue';
import { actorFromSession } from '@/lib/review/workflow';
import InboxClient from './InboxClient';

export const dynamic = 'force-dynamic';

/**
 * «Требует моего действия» (#103): назначения на этапы, исправления на
 * проверку, возвращённые комплекты и уведомления. Очередь не даёт прав —
 * решение на этапе по-прежнему выносит только роль этапа.
 */
export default async function InboxPage() {
  const session = await requireRole(
    ['presale', 'architect', 'techwriter', 'gap', 'reviewer', 'admin'],
    '/inbox',
  );
  const queue = await loadMyQueue(actorFromSession(session));

  return (
    <div className="page">
      <PageHeader
        title="Требует моего действия"
        description="Ваши назначения, исправления на проверку и возвращённые комплекты. Просроченное — сверху."
      />
      <InboxClient initial={queue} />
    </div>
  );
}
