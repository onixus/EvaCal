import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getInternalSession } from '@/lib/access';
import {
  appRoleLabel,
  defaultReviewStageFor,
  hasArchitectPowers,
  hasReviewerPowers,
  PROJECT_VIEWER_ROLES,
} from '@/lib/appRoles';
import { formatDays, LIFECYCLE_STEPS, summarizeLifecycle } from '@/lib/lifecycle';
import { loadPortfolioLifecycle, type PortfolioProject } from '@/lib/lifecycleData';
import { REVIEW_STAGE_LABELS } from '@/lib/gost34/review/types';
import PageHeader from '@/components/PageHeader';
import StageChip from '@/components/lifecycle/StageChip';

export const dynamic = 'force-dynamic';

function ageDays(from: Date): number {
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000));
}

interface QueueItem {
  href: string;
  title: string;
  subtitle: string;
  days: number;
  tone: 'block' | 'warn' | 'info';
}

/**
 * Очередь роли: что именно этот пользователь должен сделать сегодня.
 * Ревьюверы — комплекты на своём этапе, архитекторы — сметы на утверждение
 * и возвращённые комплекты, пресейл — свои черновики.
 */
async function loadQueue(
  role: string,
  username: string,
): Promise<{ title: string; items: QueueItem[] }> {
  if (hasReviewerPowers(role) && !hasArchitectPowers(role)) {
    const stage = defaultReviewStageFor(role);
    const pkgs = await prisma.gostPackage.findMany({
      where: { status: 'under_review', reviewStage: stage },
      orderBy: [{ releasedAt: 'asc' }, { createdAt: 'asc' }],
      take: 8,
      include: { project: { select: { customer: true, name: true } } },
    });
    return {
      title: stage === 'gap' ? 'Ждут вашего решения' : 'На нормоконтроле',
      items: pkgs.map((p) => {
        const days = ageDays(p.releasedAt ?? p.createdAt);
        return {
          href: `/review/${p.id}`,
          title: p.name,
          subtitle: `${p.project?.customer ?? ''} · v${p.version} · ${REVIEW_STAGE_LABELS[stage]}`,
          days,
          tone: days >= 5 ? 'block' : days >= 2 ? 'warn' : 'info',
        };
      }),
    };
  }

  if (hasArchitectPowers(role)) {
    const [pending, rejected, gapQueue] = await Promise.all([
      prisma.calculation.findMany({
        where: { status: 'pending_approval' },
        orderBy: { updatedAt: 'asc' },
        take: 6,
        select: { id: true, name: true, customer: true, version: true, updatedAt: true },
      }),
      prisma.gostPackage.findMany({
        where: { status: 'rejected' },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select: {
          id: true,
          name: true,
          version: true,
          calculationId: true,
          updatedAt: true,
          project: { select: { customer: true } },
        },
      }),
      prisma.gostPackage.findMany({
        where: { status: 'under_review', reviewStage: 'gap' },
        orderBy: { updatedAt: 'asc' },
        take: 4,
        select: {
          id: true,
          name: true,
          version: true,
          updatedAt: true,
          project: { select: { customer: true } },
        },
      }),
    ]);
    const items: QueueItem[] = [
      ...rejected.map((p) => ({
        href: `/calculations/${p.calculationId}/studio`,
        title: `Исправить: ${p.name}`,
        subtitle: `${p.project?.customer ?? ''} · v${p.version} · возвращён с замечаниями`,
        days: ageDays(p.updatedAt),
        tone: 'block' as const,
      })),
      ...pending.map((c) => ({
        href: `/architect/${c.id}`,
        title: `Утвердить смету: ${c.name}`,
        subtitle: `${c.customer} · v${c.version}`,
        days: ageDays(c.updatedAt),
        tone: ageDays(c.updatedAt) >= 3 ? ('warn' as const) : ('info' as const),
      })),
      ...gapQueue.map((p) => ({
        href: `/review/${p.id}`,
        title: `На подписи у ГАП: ${p.name}`,
        subtitle: `${p.project?.customer ?? ''} · v${p.version}`,
        days: ageDays(p.updatedAt),
        tone: 'info' as const,
      })),
    ];
    return { title: 'Ваша очередь', items };
  }

  // Пресейл: собственные черновики и сметы, ждущие утверждения.
  const mine = await prisma.calculation.findMany({
    where: { createdBy: username, status: { in: ['draft', 'pending_approval'] } },
    orderBy: { updatedAt: 'desc' },
    take: 8,
    select: { id: true, name: true, customer: true, version: true, status: true, updatedAt: true },
  });
  return {
    title: 'Ваши расчёты в работе',
    items: mine.map((c) => ({
      href: `/presale/${c.id}`,
      title: c.name,
      subtitle: `${c.customer} · v${c.version} · ${
        c.status === 'draft' ? 'черновик' : 'на согласовании'
      }`,
      days: ageDays(c.updatedAt),
      tone: c.status === 'draft' && ageDays(c.updatedAt) >= 7 ? 'warn' : 'info',
    })),
  };
}

const TONE_CLS = { block: 'chip-block', warn: 'chip-warn', info: 'chip-muted' } as const;

export default async function HomePage() {
  const staff = await getInternalSession();

  if (!staff) {
    return (
      <div className="page-narrow py-8">
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-8 text-white dark:from-nord-1 dark:to-nord-0">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Сметы трудозатрат и комплект ГОСТ 34
            </h1>
            <p className="mt-3 max-w-xl text-sm text-brand-100 dark:text-nord-4">
              Один путь проекта: расчёт пресейла → согласование сметы → комплект документации →
              нормоконтроль и подпись ГАП → сделка.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/login" className="btn btn-lg bg-white text-brand-700 hover:bg-brand-50">
                Вход для сотрудников
              </Link>
              <Link
                href="/leaderboard"
                className="btn btn-lg border border-white/30 text-white hover:bg-white/10"
              >
                Рейтинг команды
              </Link>
            </div>
          </div>
          <div className="grid gap-5 p-6 sm:grid-cols-3">
            {[
              ['Расчёт', 'Опросники и автоматическая оценка трудозатрат по ролям и этапам.'],
              ['План', 'Гант с задачами согласования, критический путь и ресурсный план.'],
              ['ГОСТ 34', 'ТЗ, ПЗ, ПМИ и спецификация в DOCX; двухэтапное ревью выпуска.'],
            ].map(([t, d]) => (
              <div key={t}>
                <h3 className="text-sm font-bold text-slate-900 dark:text-nord-6">{t}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-nord-muted">
                  {d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const canSeeProjects = (PROJECT_VIEWER_ROLES as string[]).includes(staff.role);
  const [portfolio, queue] = await Promise.all([
    canSeeProjects ? loadPortfolioLifecycle() : Promise.resolve([] as PortfolioProject[]),
    loadQueue(staff.role, staff.username),
  ]);
  const summary = summarizeLifecycle(portfolio.map((p) => p.lifecycle));
  const attention = portfolio
    .filter((p) => p.lifecycle.attention === 'rejected' || p.lifecycle.attention === 'stale')
    .sort((a, b) => b.lifecycle.days - a.lifecycle.days)
    .slice(0, 8);

  return (
    <div className="page">
      <PageHeader
        title="Рабочий стол"
        description={`${staff.username} · ${appRoleLabel(staff.role)}. Конвейер проектов и ваша очередь на сегодня.`}
        actions={
          <>
            {canSeeProjects && (
              <Link href="/projects" className="btn-secondary">
                Все проекты
              </Link>
            )}
          </>
        }
      />

      {canSeeProjects && (
        <section className="card p-4" aria-labelledby="pipeline-title">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pipeline-title" className="card-title">
              Конвейер проектов
            </h2>
            <span className="text-xs text-slate-500 dark:text-nord-muted">
              {summary.total} в работе ·{' '}
              {summary.attention > 0 ? (
                <span className="font-semibold text-rose-700 dark:text-nord-redText">
                  {summary.attention} требуют внимания
                </span>
              ) : (
                'зависших нет'
              )}
            </span>
          </div>
          <ol className="grid gap-1.5 sm:grid-cols-4 xl:grid-cols-8">
            {LIFECYCLE_STEPS.map((step, i) => {
              const count = summary.byStage[step.id];
              return (
                <li key={step.id}>
                  <Link
                    href={`/projects?stage=${step.id}`}
                    className={`flex h-full flex-col rounded-lg border px-2.5 py-2 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:hover:border-nord-frost4 dark:hover:bg-nord-3 ${
                      count > 0
                        ? 'border-slate-200 bg-white dark:border-nord-3 dark:bg-nord-2'
                        : 'border-dashed border-slate-200 bg-transparent dark:border-nord-3'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
                      {i + 1}. {step.short}
                    </span>
                    <span
                      className={`nums mt-0.5 text-xl font-extrabold ${
                        count > 0
                          ? 'text-slate-900 dark:text-nord-6'
                          : 'text-slate-300 dark:text-nord-3'
                      }`}
                    >
                      {count}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-nord-muted">
                      {step.owner}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className={`grid gap-5 ${canSeeProjects ? 'xl:grid-cols-2' : ''}`}>
        <section className="card" aria-labelledby="queue-title">
          <div className="card-head">
            <h2 id="queue-title" className="card-title">
              {queue.title}
            </h2>
            <span className="text-xs text-slate-500 dark:text-nord-muted">
              {queue.items.length}
            </span>
          </div>
          {queue.items.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500 dark:text-nord-muted">
              Очередь пуста — на сегодня задач нет.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-nord-3">
              {queue.items.map((item) => (
                <li key={item.href + item.title}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-nord-3/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-900 dark:text-nord-6">
                        {item.title}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500 dark:text-nord-muted">
                        {item.subtitle}
                      </span>
                    </span>
                    <span className={TONE_CLS[item.tone]}>{formatDays(item.days)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canSeeProjects && (
          <section className="card" aria-labelledby="attention-title">
            <div className="card-head">
              <h2 id="attention-title" className="card-title">
                Проекты, требующие внимания
              </h2>
              <span className="text-xs text-slate-500 dark:text-nord-muted">
                зависли или возвращены
              </span>
            </div>
            {attention.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500 dark:text-nord-muted">
                Все проекты движутся в норме.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-nord-3">
                {attention.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/projects/${p.id}`}
                        className="block truncate text-xs font-semibold text-slate-900 hover:text-brand-700 dark:text-nord-6 dark:hover:text-nord-frost2"
                      >
                        {p.code ? `${p.code} · ` : ''}
                        {p.name}
                      </Link>
                      <span className="block truncate text-[11px] text-slate-500 dark:text-nord-muted">
                        {p.customer} · {p.lifecycle.note}
                      </span>
                    </span>
                    <StageChip state={p.lifecycle} />
                    {p.lifecycle.next && (
                      <Link
                        href={p.lifecycle.next.href}
                        className="btn-ghost btn-sm hidden sm:inline-flex"
                      >
                        {p.lifecycle.next.label} →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
