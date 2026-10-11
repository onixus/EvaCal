import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { listKits } from '@/lib/solutionKits/store';
import { parseKitScope } from '@/lib/solutionKits/content';
import { KIT_STATUS_LABELS, type KitStatus } from '@/lib/solutionKits/rules';
import NewKitForm from './NewKitForm';

export const dynamic = 'force-dynamic';

/** Библиотека проектных решений (#103 WP-7a): список наборов. */
export default async function SolutionKitsPage() {
  const kits = await listKits();
  return (
    <div className="page">
      <PageHeader
        title="Библиотека решений"
        description="Версионируемые наборы «требования + работы + риски + проверки + фрагменты документов». Утверждённая версия неизменна; правки — новой версией."
      />

      <div className="card">
        <div className="card-head">
          <span className="card-title">Новый набор</span>
        </div>
        <div className="p-4">
          <NewKitForm />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <span className="card-title">Наборы ({kits.length})</span>
        </div>
        <table className="table-list">
          <thead>
            <tr>
              <th>Набор</th>
              <th>Область применимости</th>
              <th>Владелец</th>
              <th>Статус</th>
              <th className="text-right">Текущая</th>
              <th className="text-right">Черновик</th>
            </tr>
          </thead>
          <tbody>
            {kits.map((kit) => {
              const scope = parseKitScope(kit.scope);
              return (
                <tr key={kit.id}>
                  <td>
                    <Link href={`/admin/solution-kits/${kit.id}`} className="font-medium underline">
                      {kit.name}
                    </Link>
                    <div className="text-xs text-slate-500 dark:text-nord-muted">
                      {kit.key} · {kit.source}
                    </div>
                  </td>
                  <td className="text-xs">
                    {[...(scope?.industries ?? []), ...(scope?.productTypes ?? [])].join('; ') ||
                      '—'}
                  </td>
                  <td className="text-xs">{kit.ownerName ?? 'системный'}</td>
                  <td className="text-xs">
                    {KIT_STATUS_LABELS[kit.status as KitStatus] ?? kit.status}
                  </td>
                  <td className="nums text-right">
                    {kit.currentVersion ? `v${kit.currentVersion}` : '—'}
                  </td>
                  <td className="nums text-right">
                    {kit.draftVersion ? `v${kit.draftVersion}` : '—'}
                  </td>
                </tr>
              );
            })}
            {kits.length === 0 && (
              <tr>
                <td colSpan={6} className="text-xs text-slate-500 dark:text-nord-muted">
                  Наборов нет. Встроенные наборы создаёт сид (`npm run db:seed`).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
