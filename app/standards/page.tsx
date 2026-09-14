import { requireRole } from '@/lib/auth';
import { DEFAULT_CHECKLIST } from '@/lib/gost34/review/types';
import { GOST34_PROFILES } from '@/lib/gost34/standards/profiles';
import PageHeader from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

/**
 * Справочник ревьювера: по каким пунктам ведётся нормоконтроль и какие
 * нормативные профили действуют. Только чтение — правки чек-листа делаются
 * в самом ревью, на конкретном комплекте.
 */
export default async function StandardsPage() {
  await requireRole(['techwriter', 'gap', 'reviewer', 'architect', 'admin'], '/standards');

  return (
    <div className="page">
      <PageHeader
        title="Чек-листы и стандарты"
        description="Базовый чек-лист нормоконтроля и реестр нормативных профилей. Отметки ставятся на экране ревью конкретного комплекта."
      />

      <div className="card">
        <div className="card-head">
          <span className="card-title">Чек-лист нормоконтроля</span>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-nord-3">
          {DEFAULT_CHECKLIST.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-nord-6">
                  {item.title}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400 dark:text-nord-muted">
                  {item.note}
                </div>
              </div>
              <span className="chip-muted shrink-0">
                {item.kind === 'auto' ? 'авто' : 'вручную'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Нормативные профили</span>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-nord-3">
          {GOST34_PROFILES.map((profile) => (
            <div key={profile.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-nord-6">
                  {profile.name}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-400 dark:text-nord-muted">
                  {profile.id} · {profile.version}
                </div>
              </div>
              <span className={profile.status === 'stable' ? 'chip-ok' : 'chip-warn'}>
                {profile.status === 'stable' ? 'действующий' : 'preview'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
