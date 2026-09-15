import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { LEADERBOARD_PERIODS, parsePeriod } from '@/lib/leaderboard';
import { loadAccuracyAnalytics, loadDealAnalytics } from '@/lib/actualsData';
import { loadDeviationCatalog } from '@/lib/deviationsData';
import DeviationChart from '@/components/DeviationChart';
import StatCard from '@/components/StatCard';
import PageHeader from '@/components/PageHeader';
import FilterChips from '@/components/filters/FilterChips';
import AnalyticsTabs from './AnalyticsTabs';
import { accuracyTone, type WinRate } from '@/lib/actuals';
import { roleLabel } from '@/lib/roles';

export const dynamic = 'force-dynamic';

type Tab = 'deals' | 'accuracy' | 'deviations';

const TABS: { value: Tab; label: string }[] = [
  { value: 'deals', label: 'Сделки' },
  { value: 'accuracy', label: 'Точность оценок' },
  { value: 'deviations', label: 'Отклонения по задачам' },
];

/**
 * Сделки и точность оценок (Horizon E1). Для сотрудников: тут есть названия
 * расчётов и заказчиков, в отличие от открытого рейтинга.
 */
export default async function AnalyticsPage(props: {
  searchParams: Promise<{ period?: string; tab?: string }>;
}) {
  await requireRole(
    ['presale', 'architect', 'gap', 'techwriter', 'reviewer', 'admin'],
    '/analytics',
  );
  const sp = await props.searchParams;
  const period = parsePeriod(sp.period);
  const tab: Tab =
    sp.tab === 'accuracy' ? 'accuracy' : sp.tab === 'deviations' ? 'deviations' : 'deals';

  // Грузится только то, что показывает вкладка: остальные наборы — лишние запросы.
  const deals = tab === 'deals' ? await loadDealAnalytics(period) : null;
  const accuracy = tab === 'accuracy' ? await loadAccuracyAnalytics(period) : null;
  const catalog = tab === 'deviations' ? await loadDeviationCatalog() : null;

  return (
    <div className="page">
      <PageHeader
        title="Сделки и точность оценок"
        description="Чем заканчиваются сделки и насколько факт расходится с утверждённой оценкой."
      >
        <div className="space-y-3">
          <FilterChips
            param="period"
            options={LEADERBOARD_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            value={period}
            defaultValue="all"
            ariaLabel="Период"
          />
          <AnalyticsTabs tabs={TABS} value={tab} defaultValue="deals" />
        </div>
      </PageHeader>

      {tab === 'deviations' && catalog ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              size="lg"
              title="Задач с фактом"
              value={String(catalog.tasks.filter((t) => t.samples > 0).length)}
            />
            <StatCard
              size="lg"
              title="Наблюдений"
              value={String(catalog.rows)}
              hint="этапов выигранных версий с фактом"
            />
            <div className="card flex items-center p-4 text-xs">
              <Link href="/analytics/deviations" className="btn-primary">
                Конструктор срезов →
              </Link>
            </div>
          </div>
          <Section
            title="Медиана отклонения по одинаковым задачам"
            subtitle="Факт / план − 1 по этапу; одна задача во всех выигранных проектах. Перерасход вправо, недорасход влево, серое — в допуске ±10%."
          >
            <div className="p-4">
              <DeviationChart
                bars={catalog.tasks
                  .filter((t) => t.samples > 0)
                  .map((t) => ({
                    key: t.key,
                    label: t.label,
                    value: t.medianDeviation,
                    samples: t.samples,
                    lowSample: t.samples < 3,
                    detail: `${t.label}: роли ${t.roles.map(roleLabel).join(', ')}`,
                  }))}
                maxBars={25}
              />
            </div>
          </Section>
          <Section title="Таблица задач" subtitle="Те же данные списком">
            <Table
              head={['Задача', 'Наблюдений', 'Роли', 'Медиана откл.']}
              rows={catalog.tasks.map((t) => [
                t.label,
                String(t.samples),
                t.roles.map(roleLabel).join(', '),
                signed(t.medianDeviation) + (t.samples < 3 ? ' *' : ''),
              ])}
              tones={catalog.tasks.map((t) => accuracyTone(t.medianDeviation))}
              empty="Факт по этапам ещё не вносился."
              note="* меньше 3 наблюдений"
            />
          </Section>
        </div>
      ) : tab === 'deals' && deals ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard size="lg" title="Сделок" value={String(deals.total)} />
            <StatCard size="lg" title="Выиграно" value={String(deals.winRate.won)} />
            <StatCard size="lg" title="Проиграно" value={String(deals.winRate.lost)} />
            <StatCard size="lg" title="Отменено" value={String(deals.winRate.cancelled)} />
            <StatCard
              size="lg"
              title="Win rate"
              value={fmtRate(deals.winRate)}
              hint={deals.winRate.lowSample ? 'мало данных' : undefined}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Скидка и исход" subtitle="Win rate решённых сделок по размеру скидки">
              <Table
                head={['Скидка', 'Выигр.', 'Проигр.', 'Win rate']}
                rows={deals.byDiscount.map((b) => [
                  b.label,
                  String(b.winRate.won),
                  String(b.winRate.lost),
                  fmtRate(b.winRate) + (b.winRate.lowSample ? ' *' : ''),
                ])}
                empty="Решённых сделок пока нет."
                note="* меньше 5 решённых сделок в группе — ориентир, а не закономерность"
              />
            </Section>
            <Section title="Причины проигрышей" subtitle="По проигранным сделкам периода">
              <Table
                head={['Причина', 'Сделок', 'Доля']}
                rows={deals.lossReasons.map((r) => [r.label, String(r.count), pct(r.share)])}
                empty="Проигранных сделок нет."
              />
            </Section>
            <Section title="По месяцам" subtitle="Закрытые сделки по дате исхода">
              <Table
                head={['Месяц', 'Выигр.', 'Проигр.', 'Win rate']}
                rows={deals.monthly.map((m) => [
                  m.month,
                  String(m.won),
                  String(m.lost),
                  pct(m.rate),
                ])}
                empty="Закрытых сделок нет."
              />
            </Section>
            <Section title="По шаблонам и пресейлам" subtitle="Кто и на чём выигрывает">
              <Table
                head={['Группа', 'Выигр.', 'Проигр.', 'Win rate']}
                rows={[
                  ...deals.byTemplate.map((g) => [
                    `Шаблон: ${g.group}`,
                    String(g.winRate.won),
                    String(g.winRate.lost),
                    fmtRate(g.winRate),
                  ]),
                  ...deals.byPresale.map((g) => [
                    `Пресейл: ${g.group}`,
                    String(g.winRate.won),
                    String(g.winRate.lost),
                    fmtRate(g.winRate),
                  ]),
                ]}
                empty="Сделок нет."
              />
            </Section>
          </div>
        </div>
      ) : accuracy ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard size="lg" title="Выигранных проектов" value={String(accuracy.projects)} />
            <StatCard size="lg" title="С внесённым фактом" value={String(accuracy.withActuals)} />
            <StatCard
              size="lg"
              title="Медиана |отклонения|"
              value={
                accuracy.points.length
                  ? pct(medianAbs(accuracy.points.map((p) => p.deviation ?? 0)))
                  : '—'
              }
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title="Смещение по ролям"
              subtitle="Медиана отклонения факта от плана по этапам роли"
            >
              <Table
                head={['Роль', 'Этапов', 'Смещение']}
                rows={accuracy.byRole.map((r) => [
                  roleLabel(r.role),
                  String(r.samples),
                  signed(r.medianDeviation) + (r.lowSample ? ' *' : ''),
                ])}
                empty="Факт по этапам ещё не вносился."
                note="+ означает «тратим больше, чем оценили»; * меньше 5 этапов"
              />
            </Section>
            <Section
              title="По архитекторам"
              subtitle="Медиана |отклонения| по согласованным ими расчётам"
            >
              <Table
                head={['Архитектор', 'Расчётов', '|Откл.|', 'Знак']}
                rows={accuracy.byArchitect.map((g) => [
                  g.group,
                  String(g.samples),
                  pct(g.medianAbsDeviation) + (g.lowSample ? ' *' : ''),
                  signed(g.medianDeviation),
                ])}
                empty="Нет расчётов с фактом."
              />
            </Section>
            <Section title="По шаблонам" subtitle="Где формула систематически промахивается">
              <Table
                head={['Шаблон', 'Расчётов', '|Откл.|', 'Знак']}
                rows={accuracy.byTemplate.map((g) => [
                  g.group,
                  String(g.samples),
                  pct(g.medianAbsDeviation) + (g.lowSample ? ' *' : ''),
                  signed(g.medianDeviation),
                ])}
                empty="Нет расчётов с фактом."
              />
            </Section>
            <Section title="Расчёты" subtitle="Утверждено против факта">
              <Table
                head={['Расчёт', 'План', 'Факт', 'Откл.']}
                rows={accuracy.points.map((p) => [
                  `${p.name}${p.complete ? '' : ' (факт неполный)'}`,
                  `${p.planned} ч`,
                  `${p.actual} ч`,
                  signed(p.deviation),
                ])}
                tones={accuracy.points.map((p) => accuracyTone(p.deviation))}
                empty="Нет расчётов с фактом."
              />
            </Section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fmtRate(w: WinRate): string {
  return w.rate === null ? '—' : `${Math.round(w.rate * 100)}%`;
}
function pct(r: number | null): string {
  return r === null ? '—' : `${Math.round(r * 100)}%`;
}
function signed(r: number | null): string {
  return r === null ? '—' : `${r > 0 ? '+' : ''}${Math.round(r * 100)}%`;
}
function medianAbs(values: number[]): number | null {
  const s = values.map(Math.abs).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const TONE_CLS: Record<string, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-nord-yellow',
  bad: 'text-rose-700 dark:text-rose-300',
  none: '',
};

function Section(props: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="card-head">
        <div className="min-w-0">
          <h2 className="card-title">{props.title}</h2>
          <p className="text-xs text-slate-500 dark:text-nord-muted">{props.subtitle}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function Table(props: {
  head: string[];
  rows: string[][];
  tones?: string[];
  empty: string;
  note?: string;
}) {
  if (props.rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-slate-500 dark:text-nord-muted">
        {props.empty}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
          <tr>
            {props.head.map((h, i) => (
              <th key={h} className={`px-4 py-1.5 ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
          {props.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={`px-4 py-2 ${ci > 0 ? 'text-right tabular-nums' : 'font-medium text-slate-800 dark:text-nord-5'} ${
                    ci === r.length - 1 ? (TONE_CLS[props.tones?.[ri] ?? 'none'] ?? '') : ''
                  }`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {props.note && (
        <p className="px-4 py-2 text-[10px] text-slate-400 dark:text-nord-muted">{props.note}</p>
      )}
    </div>
  );
}
