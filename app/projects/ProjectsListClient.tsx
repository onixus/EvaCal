'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Pagination from '@/components/Pagination';
import PageHeader from '@/components/PageHeader';
import FilterChips from '@/components/filters/FilterChips';
import SearchField from '@/components/filters/SearchField';
import { useQueryFilters } from '@/components/filters/useQueryFilters';
import StageChip from '@/components/lifecycle/StageChip';
import { PAGE_SIZE } from '@/lib/pagination';
import { LIFECYCLE_STEPS, lifecycleStep, type LifecycleState } from '@/lib/lifecycle';

export interface ProjectListItem {
  id: string;
  name: string;
  code: string | null;
  customer: string;
  description: string | null;
  status: string;
  dealStatus: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  calculationCount: number;
  packageCount: number;
  lifecycle: LifecycleState;
  latestCalculation: {
    id: string;
    version: number;
    name: string;
    status: string;
    totalHours: number;
    updatedAt: string;
  } | null;
  latestPackage: {
    id: string;
    name: string;
    version: number;
    status: string;
    updatedAt: string;
  } | null;
}

interface ProjectsListClientProps {
  projects: ProjectListItem[];
  total: number;
  currentPage: number;
  searchQuery: string;
  statusFilter: string;
  stageFilter: string | null;
  statusCounts: Record<'all' | 'active' | 'on_hold' | 'completed' | 'archived', number>;
  canCreate: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  on_hold: 'На паузе',
  completed: 'Завершён',
  archived: 'Архив',
};

const STATUS_CHIP: Record<string, string> = {
  active: 'chip-ok',
  on_hold: 'chip-warn',
  completed: 'chip-info',
  archived: 'chip-muted',
};

const PACKAGE_LABELS: Record<string, string> = {
  approved: 'утверждён',
  under_review: 'на ревью',
  rejected: 'отклонён',
  archived: 'архив',
  draft: 'черновик',
};

export default function ProjectsListClient({
  projects,
  total,
  currentPage,
  searchQuery,
  statusFilter,
  stageFilter,
  statusCounts,
  canCreate,
}: ProjectsListClientProps) {
  const router = useRouter();
  const { set } = useQueryFilters();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New project form state
  const [newProject, setNewProject] = useState({
    name: '',
    customer: '',
    code: '',
    description: '',
    status: 'active',
  });

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newProject.name.trim() || !newProject.customer.trim()) {
      setError('Название проекта и заказчик обязательны');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось создать проект');
      }

      const created = await res.json();
      setIsCreateModalOpen(false);
      router.push(`/projects/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания проекта');
    } finally {
      setCreating(false);
    }
  }

  const query = new URLSearchParams();
  if (searchQuery) query.set('search', searchQuery);
  if (statusFilter !== 'all') query.set('status', statusFilter);
  if (stageFilter) query.set('stage', stageFilter);
  const paginationBasePath = query.toString() ? `/projects?${query}` : '/projects';
  const filtered = Boolean(searchQuery || statusFilter !== 'all' || stageFilter);

  return (
    <div className="page">
      <PageHeader
        title="Проекты"
        description="Реестр проектов: этап конвейера, текущая смета и комплект ГОСТ 34 по каждому."
        actions={
          canCreate ? (
            <button onClick={() => setIsCreateModalOpen(true)} className="btn-primary">
              + Новый проект
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterChips
            param="status"
            ariaLabel="Статус проекта"
            value={statusFilter}
            defaultValue="all"
            options={[
              { value: 'all', label: 'Все', count: statusCounts.all },
              { value: 'active', label: 'Активные', count: statusCounts.active },
              { value: 'on_hold', label: 'На паузе', count: statusCounts.on_hold },
              { value: 'completed', label: 'Завершённые', count: statusCounts.completed },
              { value: 'archived', label: 'Архив', count: statusCounts.archived },
            ]}
          />
          <SearchField placeholder="Название, шифр, заказчик…" className="w-full sm:w-72" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
            Этап
          </span>
          <FilterChips
            param="stage"
            ariaLabel="Этап конвейера"
            value={stageFilter ?? 'all'}
            defaultValue="all"
            options={[
              { value: 'all', label: 'Любой' },
              ...LIFECYCLE_STEPS.map((s) => ({ value: s.id, label: s.short })),
            ]}
          />
        </div>
      </PageHeader>

      {projects.length === 0 ? (
        <div className="card p-10 text-center">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-nord-5">
            {filtered ? 'Проекты не найдены' : 'Пока нет ни одного проекта'}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-nord-muted">
            {filtered
              ? 'Измените поисковый запрос или снимите фильтры.'
              : 'Создайте первый проект, чтобы привязать к нему расчёты и выпуск ГОСТ 34.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {filtered && (
              <button
                type="button"
                onClick={() => set({ search: null, status: null, stage: null })}
                className="btn-secondary"
              >
                Сбросить фильтры
              </button>
            )}
            {canCreate && (
              <button onClick={() => setIsCreateModalOpen(true)} className="btn-primary">
                Создать проект
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-list min-w-[960px]">
              <thead>
                <tr>
                  <th>Проект</th>
                  <th>Этап конвейера</th>
                  <th>Смета</th>
                  <th>Комплект ГОСТ 34</th>
                  <th>Статус</th>
                  <th>Обновлён</th>
                  <th className="text-right">Дальше</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const step = lifecycleStep(p.lifecycle.stage);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="flex flex-col">
                          <Link
                            href={`/projects/${p.id}`}
                            className="font-semibold text-slate-900 hover:text-brand-600 dark:text-nord-5 dark:hover:text-nord-frost2"
                          >
                            {p.name}
                          </Link>
                          <span className="text-[11px] text-slate-500 dark:text-nord-muted">
                            {p.code && (
                              <span className="mr-1.5 font-mono font-bold text-brand-600 dark:text-nord-frost3">
                                {p.code}
                              </span>
                            )}
                            {p.customer}
                          </span>
                        </div>
                      </td>
                      <td className="min-w-[180px]">
                        <div className="flex flex-col gap-0.5">
                          <StageChip state={p.lifecycle} />
                          <span
                            className="line-clamp-1 text-[11px] text-slate-500 dark:text-nord-muted"
                            title={`${step.label}: ${p.lifecycle.note}`}
                          >
                            {p.lifecycle.note}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {p.latestCalculation ? (
                          <div className="flex flex-col">
                            <span className="nums text-xs">
                              <Link
                                href={`/calculations/${p.latestCalculation.id}`}
                                className="font-semibold text-brand-700 hover:underline dark:text-nord-frost2"
                              >
                                v{p.latestCalculation.version}
                              </Link>{' '}
                              <span className="font-bold text-slate-700 dark:text-nord-5">
                                {p.latestCalculation.totalHours} ч
                              </span>
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-nord-muted">
                              версий: {p.calculationCount}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-slate-400">нет расчётов</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {p.latestPackage ? (
                          <div className="flex flex-col">
                            <span className="nums text-xs font-semibold text-slate-700 dark:text-nord-4">
                              v{p.latestPackage.version}{' '}
                              <span className="font-normal text-slate-500 dark:text-nord-muted">
                                {PACKAGE_LABELS[p.latestPackage.status] ?? p.latestPackage.status}
                              </span>
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-nord-muted">
                              выпусков: {p.packageCount}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-slate-400">не выпускался</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={STATUS_CHIP[p.status] ?? 'chip-muted'}>
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </td>
                      <td className="nums whitespace-nowrap text-xs text-slate-500 dark:text-nord-muted">
                        {new Date(p.updatedAt).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {p.lifecycle.next && p.lifecycle.attention !== 'paused' ? (
                          <Link
                            href={p.lifecycle.next.href}
                            className={`btn-sm ${
                              p.lifecycle.attention === 'rejected' ? 'btn-danger' : 'btn-secondary'
                            }`}
                          >
                            {p.lifecycle.next.label}
                          </Link>
                        ) : (
                          <Link href={`/projects/${p.id}`} className="btn-ghost btn-sm">
                            Карточка
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination
        page={currentPage}
        pageSize={PAGE_SIZE}
        total={total}
        basePath={paginationBasePath}
      />

      {/* Create Project Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="card animate-in w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-nord-3 dark:bg-nord-1/60">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-nord-6">
                  Создать новый проект
                </h3>
                <p className="text-xs text-slate-500 dark:text-nord-muted">
                  Проект объединяет версии сметы и выпуски ГОСТ 34
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                aria-label="Закрыть"
                className="text-sm font-bold text-slate-400 hover:text-slate-600 dark:hover:text-nord-4"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4 p-5">
              {error && (
                <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </div>
              )}

              <div>
                <label className="label">Название проекта *</label>
                <input
                  type="text"
                  required
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder="например, АС «Единый процессинг платежей»"
                  className="input"
                />
              </div>

              <div>
                <label className="label">Заказчик (организация) *</label>
                <input
                  type="text"
                  required
                  value={newProject.customer}
                  onChange={(e) => setNewProject({ ...newProject, customer: e.target.value })}
                  placeholder="например, ПАО «Северный банк»"
                  className="input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Код проекта (шифр)</label>
                  <input
                    type="text"
                    value={newProject.code}
                    onChange={(e) => setNewProject({ ...newProject, code: e.target.value })}
                    placeholder="PRJ-2026-001"
                    className="input font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="label">Статус</label>
                  <select
                    value={newProject.status}
                    onChange={(e) => setNewProject({ ...newProject, status: e.target.value })}
                    className="input"
                  >
                    <option value="active">Активен</option>
                    <option value="on_hold">На паузе</option>
                    <option value="completed">Завершён</option>
                    <option value="archived">Архив</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Описание / цель проекта</label>
                <textarea
                  rows={3}
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="Границы проекта, ключевые требования и стейкхолдеры…"
                  className="input"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-nord-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="btn-secondary"
                >
                  Отмена
                </button>
                <button type="submit" disabled={creating} className="btn-primary">
                  {creating ? 'Создание…' : 'Создать проект'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
