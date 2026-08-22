'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE } from '@/lib/pagination';

export interface ProjectListItem {
  id: string;
  name: string;
  code: string | null;
  customer: string;
  description: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  calculationCount: number;
  packageCount: number;
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
  activeCount: number;
  completedCount: number;
  totalPackages: number;
  currentPage: number;
  searchQuery: string;
  statusFilter: string;
}

export default function ProjectsListClient({
  projects,
  total,
  activeCount,
  completedCount,
  totalPackages,
  currentPage,
  searchQuery,
  statusFilter,
}: ProjectsListClientProps) {
  const router = useRouter();
  const [search, setSearch] = useState(searchQuery);
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

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    router.push(`/projects?${params.toString()}`);
  }

  function handleStatusChange(status: string) {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (status !== 'all') params.set('status', status);
    router.push(`/projects?${params.toString()}`);
  }

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Активен
          </span>
        );
      case 'on_hold':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            На паузе
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Завершён
          </span>
        );
      case 'archived':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-nord-1 dark:text-nord-muted">
            Архив
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-nord-1 dark:text-nord-muted">
            {status}
          </span>
        );
    }
  };

  const getPackageStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            УТВЕРЖДЁН
          </span>
        );
      case 'under_review':
        return (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            НА СОГЛАСОВАНИИ
          </span>
        );
      case 'rejected':
        return (
          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            ОТКЛОНЁН
          </span>
        );
      case 'archived':
        return (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-nord-1 dark:text-nord-muted">
            АРХИВ
          </span>
        );
      default:
        return (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-nord-1 dark:text-nord-4">
            ЧЕРНОВИК
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Portfolio Stats Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Всего проектов
          </span>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-nord-6">{total}</div>
          <div className="mt-0.5 text-xs text-slate-400 dark:text-nord-muted">
            В корпоративном реестре
          </div>
        </div>

        <div className="card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Активные проекты
          </span>
          <div className="mt-1.5 text-2xl font-bold text-emerald-600 dark:text-nord-green">
            {activeCount}
          </div>
          <div className="mt-0.5 text-xs text-slate-400 dark:text-nord-muted">
            В работе пресейла/архитектора
          </div>
        </div>

        <div className="card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Завершенные
          </span>
          <div className="mt-1.5 text-2xl font-bold text-blue-600 dark:text-nord-frost2">
            {completedCount}
          </div>
          <div className="mt-0.5 text-xs text-slate-400 dark:text-nord-muted">
            Сданные заказчикам
          </div>
        </div>

        <div className="card border-brand-200 bg-brand-50/30 p-4 dark:border-nord-frost4/40 dark:bg-nord-frost4/10">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 dark:text-nord-frost2">
            Выпуски ГОСТ 34
          </span>
          <div className="mt-1.5 text-2xl font-extrabold text-brand-700 dark:text-nord-frost2">
            {totalPackages}
          </div>
          <div className="mt-0.5 text-xs text-brand-600/80 dark:text-nord-frost3">
            Комплектов документации
          </div>
        </div>
      </div>

      {/* Header, Filters and Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-nord-6">Проекты</h1>
          <p className="text-xs text-slate-500 dark:text-nord-muted">
            Единый реестр проектов: сметы, версии расчётов и комплекты ГОСТ 34
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button onClick={() => setIsCreateModalOpen(true)} className="btn-primary">
            <span>+</span>
            <span>Новый проект</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: 'Все' },
              { id: 'active', label: 'Активные' },
              { id: 'on_hold', label: 'На паузе' },
              { id: 'completed', label: 'Завершённые' },
              { id: 'archived', label: 'Архив' },
            ].map((tab) => {
              const active = (statusFilter || 'all') === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleStatusChange(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? 'bg-brand-600 text-white shadow-xs dark:bg-nord-frost4 dark:text-nord-0'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-nord-1 dark:text-nord-4 dark:hover:bg-nord-3'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию, коду, заказчику..."
                className="input text-xs !py-1.5 pl-8"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                🔍
              </span>
            </div>
            <button type="submit" className="btn-secondary !py-1.5 !px-3 text-xs">
              Найти
            </button>
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  router.push('/projects');
                }}
                className="text-xs text-slate-500 hover:text-slate-700 dark:text-nord-muted dark:hover:text-nord-4"
              >
                Сброс
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Main Projects Table */}
      {projects.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-3xl mb-3">📁</div>
          <h3 className="font-semibold text-slate-800 dark:text-nord-5">
            {searchQuery ? 'Проекты не найдены' : 'Пока нет ни одного проекта'}
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto dark:text-nord-muted">
            {searchQuery
              ? 'Попробуйте изменить поисковый запрос или фильтр по статусу.'
              : 'Создайте первый проект для привязки расчетов и выпуска документации по ГОСТ 34.'}
          </p>
          <div className="mt-4">
            <button onClick={() => setIsCreateModalOpen(true)} className="btn-primary">
              Создать проект
            </button>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-nord-3 dark:bg-nord-1/40 dark:text-nord-muted">
                  <th className="py-3.5 px-4">Код / Проект</th>
                  <th className="py-3.5 px-4">Заказчик</th>
                  <th className="py-3.5 px-4">Статус</th>
                  <th className="py-3.5 px-4">Текущий расчёт</th>
                  <th className="py-3.5 px-4">Выпуск ГОСТ 34</th>
                  <th className="py-3.5 px-4 text-center">Версий</th>
                  <th className="py-3.5 px-4">Обновлён</th>
                  <th className="py-3.5 px-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
                {projects.map((p) => {
                  return (
                    <tr
                      key={p.id}
                      className="group transition-colors hover:bg-slate-50/80 dark:hover:bg-nord-3/30"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          {p.code && (
                            <span className="font-mono text-[11px] font-bold text-brand-600 dark:text-nord-frost3">
                              {p.code}
                            </span>
                          )}
                          <Link
                            href={`/projects/${p.id}`}
                            className="font-semibold text-slate-900 hover:text-brand-600 dark:text-nord-5 dark:hover:text-nord-frost2"
                          >
                            {p.name}
                          </Link>
                          {p.description && (
                            <span className="line-clamp-1 text-xs text-slate-400 dark:text-nord-muted">
                              {p.description}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 font-medium dark:text-nord-4">
                        {p.customer}
                      </td>
                      <td className="py-3.5 px-4">{getStatusBadge(p.status)}</td>
                      <td className="py-3.5 px-4">
                        {p.latestCalculation ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/calculations/${p.latestCalculation.id}`}
                                className="font-semibold text-xs text-brand-700 hover:underline dark:text-nord-frost2"
                              >
                                v{p.latestCalculation.version}
                              </Link>
                              <span className="text-xs text-slate-600 font-bold tabular-nums dark:text-nord-5">
                                {p.latestCalculation.totalHours} ч
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 dark:text-nord-muted">
                              {p.latestCalculation.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Нет расчётов</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {p.latestPackage ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-nord-4">
                              v{p.latestPackage.version}
                            </span>
                            {getPackageStatusBadge(p.latestPackage.status)}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Не выпускался</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-nord-4">
                          <span title="Расчётов сметы">📊 {p.calculationCount}</span>
                          <span>/</span>
                          <span title="Выпусков ГОСТ">📑 {p.packageCount}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs tabular-nums text-slate-500 dark:text-nord-muted">
                        {new Date(p.updatedAt).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100">
                          <Link
                            href={`/projects/${p.id}`}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-4 dark:hover:bg-nord-3"
                          >
                            Карточка
                          </Link>
                          {p.latestCalculation ? (
                            <Link
                              href={`/calculations/${p.latestCalculation.id}`}
                              className="rounded-md border border-brand-200 bg-brand-50/50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100/50 dark:border-nord-frost4/40 dark:bg-nord-frost4/10 dark:text-nord-frost2"
                            >
                              Хаб
                            </Link>
                          ) : (
                            <Link
                              href={`/presale?projectId=${p.id}`}
                              className="rounded-md border border-brand-200 bg-brand-50/50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100/50 dark:border-nord-frost4/40 dark:bg-nord-frost4/10 dark:text-nord-frost2"
                            >
                              + Расчёт
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {(() => {
        const queryParts = [];
        if (searchQuery) queryParts.push(`search=${encodeURIComponent(searchQuery)}`);
        if (statusFilter && statusFilter !== 'all')
          queryParts.push(`status=${encodeURIComponent(statusFilter)}`);
        const paginationBasePath =
          queryParts.length > 0 ? `/projects?${queryParts.join('&')}` : '/projects';
        return (
          <Pagination
            page={currentPage}
            pageSize={PAGE_SIZE}
            total={total}
            basePath={paginationBasePath}
          />
        );
      })()}

      {/* Create Project Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="card w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
                  Создать новый проект
                </h3>
                <p className="text-xs text-slate-500 dark:text-nord-muted">
                  Регистрация проекта в корпоративном реестре EvaCal
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              {error && (
                <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </div>
              )}

              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Название проекта *
                </label>
                <input
                  type="text"
                  required
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder="например, АС «Единый процессинг платежей»"
                  className="input text-sm"
                />
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Заказчик (Организация) *
                </label>
                <input
                  type="text"
                  required
                  value={newProject.customer}
                  onChange={(e) => setNewProject({ ...newProject, customer: e.target.value })}
                  placeholder="например, ПАО «Северный банк»"
                  className="input text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                    Код проекта (шифр)
                  </label>
                  <input
                    type="text"
                    value={newProject.code}
                    onChange={(e) => setNewProject({ ...newProject, code: e.target.value })}
                    placeholder="PRJ-2026-001"
                    className="input text-sm font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                    Статус
                  </label>
                  <select
                    value={newProject.status}
                    onChange={(e) => setNewProject({ ...newProject, status: e.target.value })}
                    className="input text-sm"
                  >
                    <option value="active">Активен</option>
                    <option value="on_hold">На паузе</option>
                    <option value="completed">Завершён</option>
                    <option value="archived">Архив</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Описание / Цель проекта
                </label>
                <textarea
                  rows={3}
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="Краткое описание границ проекта, ключевых требований и стейкхолдеров..."
                  className="input text-sm"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-nord-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Отмена
                </button>
                <button type="submit" disabled={creating} className="btn-primary text-xs">
                  {creating ? 'Создание...' : 'Создать проект'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
