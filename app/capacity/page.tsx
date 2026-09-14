import { requireRole } from '@/lib/auth';
import { loadCapacityMatrix, DEFAULT_WEEKS } from '@/lib/capacityData';
import PageHeader from '@/components/PageHeader';
import FilterChips from '@/components/filters/FilterChips';
import CapacityClient from './CapacityClient';

export const dynamic = 'force-dynamic';

const WEEKS_OPTIONS = [
  { value: '13', label: '13 недель' },
  { value: '26', label: '26 недель' },
];

const DRAFTS_OPTIONS = [
  { value: '', label: 'Без черновиков' },
  { value: '1', label: 'С черновиками' },
];

/** Ресурсный план по портфелю (Horizon E2). */
export default async function CapacityPage(props: {
  searchParams: Promise<{ weeks?: string; drafts?: string }>;
}) {
  const session = await requireRole(
    ['architect', 'gap', 'techwriter', 'reviewer', 'admin'],
    '/capacity',
  );
  const sp = await props.searchParams;
  const weeks = sp.weeks === '26' ? 26 : DEFAULT_WEEKS;
  const includeDrafts = sp.drafts === '1';
  const matrix = await loadCapacityMatrix({ weeks, includeDrafts });
  return (
    <div className="page">
      <PageHeader
        title="Ресурсный план"
        description="Загрузка ролей по неделям из Гантов всех проектов. Твёрдый спрос — выигранные и утверждённые; с воронкой — плюс согласование и черновики с весом."
        actions={
          <a
            href={`/api/capacity/xlsx?weeks=${weeks}${includeDrafts ? '&drafts=1' : ''}`}
            className="btn-secondary"
          >
            Выгрузить xlsx
          </a>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterChips
            param="weeks"
            options={WEEKS_OPTIONS}
            value={String(weeks)}
            defaultValue="13"
            ariaLabel="Горизонт"
          />
          <FilterChips
            param="drafts"
            options={DRAFTS_OPTIONS}
            value={includeDrafts ? '1' : ''}
            defaultValue=""
            ariaLabel="Черновики"
          />
        </div>
      </PageHeader>
      <CapacityClient
        initial={matrix}
        weeks={weeks}
        includeDrafts={includeDrafts}
        canWhatIf={session.role !== 'reviewer'}
      />
    </div>
  );
}
