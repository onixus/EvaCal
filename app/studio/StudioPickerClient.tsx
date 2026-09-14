'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  REVIEW_STAGE_LABELS,
  type ReviewStage,
  parseComments,
  openBlockerCount,
  parseChecklist,
} from '@/lib/gost34/review/types';

export interface StudioCalculationItem {
  id: string;
  name: string;
  customer: string;
  version: number;
  updatedAt: string;
  standardProfileId: string | null;
  packages: {
    id: string;
    name: string;
    version: number;
    status: string;
    reviewStage: ReviewStage;
    reviewComment: string | null;
    reviewComments: string | null;
    reviewChecklist: string | null;
    updatedAt: string;
    releasedAt: string | null;
  }[];
}

type FilterTab = 'all' | 'rejected' | 'draft' | 'under_review' | 'approved';

export default function StudioPickerClient({
  calculations,
}: {
  calculations: StudioCalculationItem[];
}) {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');

  // Калькуляция статусов для каждого расчёта
  const calculationsWithStatus = useMemo(() => {
    return calculations.map((calc) => {
      const latestPackage = calc.packages[0] ?? null;
      const draftPackage = calc.packages.find((p) => p.status === 'draft') ?? null;
      const rejectedPackage = calc.packages.find((p) => p.status === 'rejected') ?? null;
      const underReviewPackage = calc.packages.find((p) => p.status === 'under_review') ?? null;
      const approvedPackage = calc.packages.find((p) => p.status === 'approved') ?? null;

      let gostStatus: 'rejected' | 'draft' | 'under_review' | 'approved' | 'none' = 'none';
      if (rejectedPackage && (!draftPackage || rejectedPackage.version >= draftPackage.version)) {
        gostStatus = 'rejected';
      } else if (draftPackage) {
        gostStatus = 'draft';
      } else if (underReviewPackage) {
        gostStatus = 'under_review';
      } else if (approvedPackage) {
        gostStatus = 'approved';
      }

      return {
        ...calc,
        latestPackage,
        draftPackage,
        rejectedPackage,
        underReviewPackage,
        approvedPackage,
        gostStatus,
      };
    });
  }, [calculations]);

  const stats = useMemo(() => {
    const rejected = calculationsWithStatus.filter((c) => c.gostStatus === 'rejected').length;
    const drafts = calculationsWithStatus.filter((c) => c.gostStatus === 'draft').length;
    const underReview = calculationsWithStatus.filter(
      (c) => c.gostStatus === 'under_review',
    ).length;
    const approved = calculationsWithStatus.filter((c) => c.gostStatus === 'approved').length;
    return { rejected, drafts, underReview, approved, totalAttention: rejected + drafts };
  }, [calculationsWithStatus]);

  const rejectedList = useMemo(() => {
    return calculationsWithStatus.filter((c) => c.gostStatus === 'rejected' && c.rejectedPackage);
  }, [calculationsWithStatus]);

  const filtered = useMemo(() => {
    return calculationsWithStatus.filter((c) => {
      if (activeTab === 'rejected' && c.gostStatus !== 'rejected') return false;
      if (activeTab === 'draft' && c.gostStatus !== 'draft') return false;
      if (activeTab === 'under_review' && c.gostStatus !== 'under_review') return false;
      if (activeTab === 'approved' && c.gostStatus !== 'approved') return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchCustomer = c.customer.toLowerCase().includes(q);
        const matchComment = c.rejectedPackage?.reviewComment?.toLowerCase().includes(q);
        return matchName || matchCustomer || Boolean(matchComment);
      }
      return true;
    });
  }, [calculationsWithStatus, activeTab, search]);

  return (
    <div className="space-y-4">
      {/* Заголовок и пояснение счётчика */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
              Студия ГОСТ 34
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
              Выберите расчёт для выпуска документации: требования, профиль, применимость,
              трассируемость и экспорт.
            </p>
          </div>

          {/* Информационный бейдж счётчика */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {stats.rejected > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('rejected')}
                className="chip-block flex items-center gap-1.5 cursor-pointer hover:opacity-90"
              >
                <span>⚠️</span>
                <span>Требуют доработки: {stats.rejected}</span>
              </button>
            )}
            {stats.drafts > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('draft')}
                className="chip-warn flex items-center gap-1.5 cursor-pointer hover:opacity-90"
              >
                <span>Черновики в работе: {stats.drafts}</span>
              </button>
            )}
            {stats.underReview > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('under_review')}
                className="chip-muted flex items-center gap-1.5 cursor-pointer hover:opacity-90"
              >
                <span>На согласовании: {stats.underReview}</span>
              </button>
            )}
            {stats.approved > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('approved')}
                className="chip-ok flex items-center gap-1.5 cursor-pointer hover:opacity-90"
              >
                <span>Выпущено: {stats.approved}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Блок приоритетного внимания: комплекты, возвращённые с замечаниями */}
      {rejectedList.length > 0 &&
        activeTab !== 'draft' &&
        activeTab !== 'under_review' &&
        activeTab !== 'approved' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-nord-red/30 dark:bg-nord-red/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white dark:bg-nord-red">
                  !
                </span>
                <span className="text-sm font-extrabold text-rose-900 dark:text-nord-redText">
                  Возвращены с замечаниями ревьювера ({rejectedList.length})
                </span>
              </div>
              <span className="text-[11px] text-rose-700/80 dark:text-nord-redText/80">
                Требуется устранить замечания в Студии и выпустить новую версию
              </span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {rejectedList.map((item) => {
                const pkg = item.rejectedPackage!;
                const comments = parseComments(pkg.reviewComments);
                const checklist = parseChecklist(pkg.reviewChecklist);
                const blockers = openBlockerCount(comments, checklist);
                const stageLabel = REVIEW_STAGE_LABELS[pkg.reviewStage] ?? pkg.reviewStage;

                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-rose-200 bg-white p-3.5 shadow-sm dark:border-nord-3 dark:bg-nord-2 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-900 dark:text-nord-6">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-nord-muted">
                          {item.customer} · v{item.version} · Комплект v{pkg.version}
                        </div>
                      </div>
                      <span className="chip-block shrink-0">{stageLabel}</span>
                    </div>

                    {pkg.reviewComment && (
                      <blockquote className="rounded border-l-2 border-rose-500 bg-rose-50/60 p-2 text-xs italic text-rose-900 dark:bg-nord-red/15 dark:text-nord-redText">
                        «{pkg.reviewComment}»
                      </blockquote>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-nord-3">
                      <span className="text-[11px] font-semibold text-rose-700 dark:text-nord-redText">
                        {blockers > 0
                          ? `${blockers} ${blockers === 1 ? 'блокер' : blockers < 5 ? 'блокера' : 'блокеров'}`
                          : comments.length > 0
                            ? `${comments.length} замечаний`
                            : 'Отклонено с замечаниями'}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/review/${pkg.id}`}
                          className="btn-ghost !px-2 !py-1 !text-[11px]"
                        >
                          Лист ревью
                        </Link>
                        <Link
                          href={`/calculations/${item.id}/studio`}
                          className="btn-primary !bg-rose-600 hover:!bg-rose-700 dark:!bg-nord-red !px-2.5 !py-1 !text-[11px] !font-bold"
                        >
                          ✏️ Исправить в Студии →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* Поиск и фильтры по статусам */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-1 sm:border-0 sm:pb-0 dark:border-nord-3">
          {(
            [
              ['all', `Все (${calculations.length})`],
              ['rejected', `Отклонённые (${stats.rejected})`],
              ['draft', `Черновики (${stats.drafts})`],
              ['under_review', `На ревью (${stats.underReview})`],
              ['approved', `Утверждённые (${stats.approved})`],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? 'bg-slate-900 text-white dark:bg-nord-frost2 dark:text-nord-0'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-nord-4 dark:hover:bg-nord-3'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или заказчику…"
            className="input !py-1.5 !text-xs w-full"
          />
        </div>
      </div>

      {/* Список карточек расчётов */}
      {filtered.length === 0 ? (
        <div className="card-flat p-8 text-center text-xs text-slate-500 dark:text-nord-muted">
          {search ? 'По вашему запросу ничего не найдено.' : 'Расчётов в этой категории пока нет.'}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((calc) => {
            const hasRejected = calc.gostStatus === 'rejected' && calc.rejectedPackage;
            const hasDraft = calc.gostStatus === 'draft' && calc.draftPackage;
            const hasUnderReview = calc.gostStatus === 'under_review' && calc.underReviewPackage;
            const hasApproved = calc.gostStatus === 'approved' && calc.approvedPackage;

            return (
              <Link
                key={calc.id}
                href={`/calculations/${calc.id}/studio`}
                className={`card-flat flex flex-col justify-between p-3.5 transition-colors hover:border-slate-300 dark:hover:border-nord-4/30 ${
                  hasRejected
                    ? 'border-rose-200 bg-rose-50/20 hover:border-rose-300 dark:border-nord-red/30 dark:bg-nord-red/5'
                    : ''
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-xs font-bold text-slate-900 dark:text-nord-6">
                      {calc.name}
                    </span>
                    {hasRejected ? (
                      <span className="chip-block shrink-0">требует доработки</span>
                    ) : hasDraft ? (
                      <span className="chip-warn shrink-0">
                        черновик v{calc.draftPackage!.version}
                      </span>
                    ) : hasUnderReview ? (
                      <span className="chip-muted shrink-0">
                        на ревью v{calc.underReviewPackage!.version}
                      </span>
                    ) : hasApproved ? (
                      <span className="chip-ok shrink-0">
                        выпущен v{calc.approvedPackage!.version}
                      </span>
                    ) : (
                      <span className="chip-muted shrink-0 text-[9px]">не выпускался</span>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-400 dark:text-nord-muted">
                    {calc.customer} · v{calc.version} ·{' '}
                    {calc.standardProfileId ? 'профиль закреплён' : 'профиль не выбран'}
                  </div>

                  {hasRejected && calc.rejectedPackage?.reviewComment && (
                    <div className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-800 italic truncate dark:bg-nord-red/15 dark:text-nord-redText">
                      «{calc.rejectedPackage.reviewComment}»
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-brand-600 font-semibold dark:text-nord-frost2 dark:border-nord-3">
                  <span>Открыть в Студии</span>
                  <span>→</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
