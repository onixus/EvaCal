import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { getSession } from '@/lib/auth';
import { getKit } from '@/lib/solutionKits/store';
import { parseKitScope } from '@/lib/solutionKits/content';
import { canEditKitDrafts, canGovernKit } from '@/lib/solutionKits/rules';
import KitWorkspace from './KitWorkspace';

export const dynamic = 'force-dynamic';

/** Набор решения: паспорт, версии, содержимое, черновик, дифф, утверждение. */
export default async function SolutionKitPage(props: { params: Promise<{ kitId: string }> }) {
  const { kitId } = await props.params;
  const [kit, session] = await Promise.all([getKit(kitId), getSession()]);
  if (!kit || !session) notFound();
  const actor = { userId: session.userId, role: session.role };
  return (
    <div className="page">
      <PageHeader
        title={kit.name}
        description={`${kit.key} · источник: ${kit.source}`}
        actions={
          <Link href="/admin/solution-kits" className="btn-secondary">
            ← Библиотека
          </Link>
        }
      />
      <KitWorkspace
        kit={JSON.parse(
          JSON.stringify({
            ...kit,
            scope: parseKitScope(kit.scope) ?? { industries: [], productTypes: [], notes: '' },
          }),
        )}
        canEdit={canEditKitDrafts(actor)}
        canGovern={canGovernKit(actor, kit)}
      />
    </div>
  );
}
