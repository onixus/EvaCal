import PageHeader from '@/components/PageHeader';
import FilterChips from '@/components/filters/FilterChips';
import { appRoleLabel } from '@/lib/appRoles';
import {
  LEADERBOARD_PERIODS,
  MIN_SAMPLE,
  parsePeriod,
  type ArchitectEntry,
  type PresaleEntry,
  type RankedBoard,
} from '@/lib/leaderboard';
import { loadLeaderboard } from '@/lib/leaderboardData';

export const dynamic = 'force-dynamic';

/**
 * Открытый дашборд эффективности: лучшие и отстающие пресейлы и архитекторы.
 * Входа не требует — страница рассчитана на общий экран в переговорке.
 * Показывает только логины и агрегаты, без названий расчётов и заказчиков.
 */
export default async function LeaderboardPage(props: {
  searchParams: Promise<{ period?: string }>;
}) {
  const searchParams = await props.searchParams;
  const period = parsePeriod(searchParams.period);
  const board = await loadLeaderboard(period);

  return (
    <div className="page-wide">
      <PageHeader
        title="Рейтинг команды"
        description="Самые эффективные и отстающие пресейлы и архитекторы. Открытый экран: только логины и счётчики, без данных заказчиков."
      >
        <FilterChips
          param="period"
          options={LEADERBOARD_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          value={period}
          defaultValue="all"
          ariaLabel="Период"
        />
      </PageHeader>

      <div className="grid gap-5 min-[1800px]:grid-cols-2">
        <PresaleSection board={board.presale} />
        <ArchitectSection board={board.architects} />
      </div>

      <Methodology />

      <p className="text-[10px] text-slate-400 dark:text-nord-muted">
        Обновлено {new Date(board.generatedAt).toLocaleString('ru-RU')} ·{' '}
        <a href={`/api/leaderboard?period=${period}`} className="underline">
          JSON
        </a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SectionShell(props: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="card-flat min-w-0 overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-2.5 dark:border-nord-3">
        <div className="text-xs font-bold text-slate-900 dark:text-nord-6">{props.title}</div>
        <div className="text-[10px] text-slate-400 dark:text-nord-muted">{props.subtitle}</div>
      </div>
      {props.children}
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-nord-muted">{text}</p>
  );
}

function BoardHeading({ kind, count }: { kind: 'top' | 'bottom'; count: number }) {
  const top = kind === 'top';
  return (
    <div
      className={`flex items-center gap-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
        top
          ? 'bg-emerald-50/60 text-emerald-700 dark:bg-nord-green/10 dark:text-nord-green'
          : 'bg-rose-50/60 text-rose-700 dark:bg-nord-red/10 dark:text-nord-redText'
      }`}
    >
      <span aria-hidden>{top ? '▲' : '▼'}</span>
      {top ? 'Самые эффективные' : 'Наименее эффективные'}
      <span className="nums ml-auto font-semibold normal-case tracking-normal opacity-70">
        {count}
      </span>
    </div>
  );
}

function ScoreBar({ score, tone }: { score: number; tone: 'top' | 'bottom' | 'neutral' }) {
  const fill =
    tone === 'top'
      ? 'bg-emerald-500 dark:bg-nord-green'
      : tone === 'bottom'
        ? 'bg-rose-500 dark:bg-nord-red'
        : 'bg-brand-600 dark:bg-nord-frost4';
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label={`Оценка ${score} из 100`}
        className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-nord-1"
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${score}%` }} />
      </div>
      <span className="nums w-7 text-right text-xs font-extrabold text-slate-900 dark:text-nord-6">
        {score}
      </span>
    </div>
  );
}

function PersonCell({
  entry,
  rank,
}: {
  entry: { name: string; role: string; lowSample: boolean };
  rank: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="nums w-5 shrink-0 text-right text-[10px] font-bold text-slate-400 dark:text-nord-muted">
        {rank}
      </span>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold uppercase text-white dark:bg-nord-frost4">
        {entry.name.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-slate-900 dark:text-nord-6">
          {entry.name}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-nord-muted">
          <span>{entry.role === 'guest' ? 'без учётки' : appRoleLabel(entry.role)}</span>
          {entry.lowSample && (
            <span className="chip-muted" title={`Меньше ${MIN_SAMPLE} действий — оценка ненадёжна`}>
              мало данных
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)} %`;
}

function days(v: number | null): string {
  return v === null ? '—' : `${v} дн.`;
}

// ---------------------------------------------------------------------------

function PresaleSection({ board }: { board: RankedBoard<PresaleEntry> }) {
  return (
    <SectionShell
      title="Пресейлы"
      subtitle="Конверсия расчётов в утверждённые, переделки и скорость согласования"
    >
      {board.all.length === 0 ? (
        <EmptyRow text="За выбранный период расчётов не создавалось." />
      ) : (
        <>
          <BoardHeading kind="top" count={board.top.length} />
          <PresaleTable rows={board.top} tone="top" offset={0} />
          {board.bottom.length > 0 && (
            <>
              <BoardHeading kind="bottom" count={board.bottom.length} />
              <PresaleTable
                rows={board.bottom}
                tone="bottom"
                offset={board.all.length - board.bottom.length}
                reversed
              />
            </>
          )}
        </>
      )}
    </SectionShell>
  );
}

function PresaleTable(props: {
  rows: PresaleEntry[];
  tone: 'top' | 'bottom';
  offset: number;
  reversed?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-nord-muted">
          <tr className="border-b border-slate-100 dark:border-nord-3">
            <th className="px-4 py-1.5 text-left font-semibold">Сотрудник</th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Расчётов создано"
            >
              Расч.
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Утверждено / всего"
            >
              Конверсия
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Доля расчётов с новой версией"
            >
              Переделки
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Медиана дней до утверждения"
            >
              Цикл
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Выиграно / (выиграно + проиграно) по исходам сделок"
            >
              Win rate
            </th>
            <th className="whitespace-nowrap px-4 py-1.5 text-right font-semibold">Оценка</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
          {props.rows.map((row, i) => {
            const rank = props.reversed
              ? props.offset + props.rows.length - i
              : props.offset + i + 1;
            return (
              <tr key={row.name}>
                <td className="px-4 py-2">
                  <PersonCell entry={row} rank={rank} />
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {row.total}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {pct(row.conversion)}
                  <span className="ml-1 text-[10px] text-slate-400 dark:text-nord-muted">
                    ({row.approved}/{row.total})
                  </span>
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {pct(row.reworkRate)}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {days(row.medianCycleDays)}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {row.winRate === null ? '—' : pct(row.winRate)}
                  {row.won + row.lost > 0 && (
                    <span className="ml-1 text-[10px] text-slate-400 dark:text-nord-muted">
                      ({row.won}/{row.won + row.lost})
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <div className="flex justify-end">
                    <ScoreBar score={row.score} tone={props.tone} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ArchitectSection({ board }: { board: RankedBoard<ArchitectEntry> }) {
  return (
    <SectionShell
      title="Архитекторы"
      subtitle="Приёмка комплектов ГОСТ 34 с первого раза, пропускная способность и скорость ревью"
    >
      {board.all.length === 0 ? (
        <EmptyRow text="За выбранный период комплекты не выпускались и расчёты не согласовывались." />
      ) : (
        <>
          <BoardHeading kind="top" count={board.top.length} />
          <ArchitectTable rows={board.top} tone="top" offset={0} />
          {board.bottom.length > 0 && (
            <>
              <BoardHeading kind="bottom" count={board.bottom.length} />
              <ArchitectTable
                rows={board.bottom}
                tone="bottom"
                offset={board.all.length - board.bottom.length}
                reversed
              />
            </>
          )}
        </>
      )}
    </SectionShell>
  );
}

function ArchitectTable(props: {
  rows: ArchitectEntry[];
  tone: 'top' | 'bottom';
  offset: number;
  reversed?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-nord-muted">
          <tr className="border-b border-slate-100 dark:border-nord-3">
            <th className="px-4 py-1.5 text-left font-semibold">Сотрудник</th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Согласовано расчётов пресейла"
            >
              Согл.
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Выпущено комплектов ГОСТ 34"
            >
              Выпуск
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Утверждено в роли ГАП"
            >
              ГАП
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Свои комплекты, принятые без возврата"
            >
              Приёмка
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Медиана дней от выпуска до утверждения"
            >
              Ревью
            </th>
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-semibold"
              title="Медиана |факт − план| / план по согласованным расчётам с фактом"
            >
              Точность
            </th>
            <th className="whitespace-nowrap px-4 py-1.5 text-right font-semibold">Оценка</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
          {props.rows.map((row, i) => {
            const rank = props.reversed
              ? props.offset + props.rows.length - i
              : props.offset + i + 1;
            const decided = row.authoredApproved + row.authoredRejected;
            return (
              <tr key={row.name}>
                <td className="px-4 py-2">
                  <PersonCell entry={row} rank={rank} />
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {row.calcApproved}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {row.released}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {row.gapApproved}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {pct(row.firstPassRate)}
                  {decided > 0 && (
                    <span className="ml-1 text-[10px] text-slate-400 dark:text-nord-muted">
                      ({row.authoredApproved}/{decided})
                    </span>
                  )}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {days(row.medianTurnaroundDays)}
                </td>
                <td className="nums whitespace-nowrap px-2 py-2 text-right text-slate-700 dark:text-nord-4">
                  {row.medianAbsDeviation === null ? '—' : `±${pct(row.medianAbsDeviation)}`}
                  {row.accuracySamples > 0 && (
                    <span className="ml-1 text-[10px] text-slate-400 dark:text-nord-muted">
                      ({row.accuracySamples})
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <div className="flex justify-end">
                    <ScoreBar score={row.score} tone={props.tone} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Methodology() {
  return (
    <details className="card-flat text-xs text-slate-600 dark:text-nord-4">
      <summary className="cursor-pointer px-4 py-2.5 font-bold text-slate-900 dark:text-nord-6">
        Как считается оценка
      </summary>
      <div className="grid gap-4 border-t border-slate-100 px-4 py-3 dark:border-nord-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="font-semibold text-slate-900 dark:text-nord-6">Пресейл (0–100)</div>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>70 % — конверсия: доля созданных расчётов, утверждённых архитектором.</li>
            <li>20 % — отсутствие переделок: доля расчётов без повторных версий.</li>
            <li>10 % — объём относительно самого активного пресейла за период.</li>
            <li>
              Цикл — медиана дней от создания расчёта до его последнего изменения в статусе
              «утверждён».
            </li>
          </ul>
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-slate-900 dark:text-nord-6">Архитектор (0–100)</div>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              50 % — приёмка: доля своих комплектов ГОСТ 34, утверждённых без возврата на доработку.
              Пока решений нет — нейтральные 50 %.
            </li>
            <li>
              30 % — пропускная способность: согласованные расчёты, выпущенные комплекты и решения
              ГАП относительно самого продуктивного коллеги.
            </li>
            <li>20 % — скорость: медиана дней от выпуска комплекта до его утверждения.</li>
            <li>
              Согласования расчётов считаются по журналу аудита и накапливаются с момента включения
              учёта.
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400 dark:border-nord-3 dark:text-nord-muted">
        Метка «мало данных» ставится при менее {MIN_SAMPLE} действий за период: такая оценка
        показывается, но выводы по ней делать рано.
      </p>
    </details>
  );
}
