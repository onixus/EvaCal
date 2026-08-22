'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import StatusBadge from '@/components/StatusBadge';
import { calculateCommercialSummary, formatCurrency } from '@/lib/commercial';
import { safeJsonParse } from '@/lib/json';

export interface SerializedStage {
  id: string;
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  order: number;
}

export interface SerializedRisk {
  id: string;
  description: string;
  hours: number;
  order: number;
}

export interface SerializedCalculation {
  id: string;
  name: string;
  customer: string;
  version: number;
  status: string;
  versionComment: string | null;
  startDate: string;
  pmHours: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  template: { id: string; name: string };
  stages: SerializedStage[];
  risks: SerializedRisk[];
  currency: string;
  roleRates: string | null;
  overheadPercent: number;
  marginPercent: number;
  discountPercent: number;
  vatPercent: number;
  includeVat: boolean;
  standardProfileId: string | null;
  standardProfileVersion: string | null;
  generatorVersion: string | null;
}

export interface SerializedGostPackage {
  id: string;
  name: string;
  version: number;
  status: string;
  calculationId: string;
  calculation?: { id: string; name: string; version: number; status: string } | null;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string; // JSON
  metadata: string | null; // JSON
  checksum: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedProject {
  id: string;
  name: string;
  customer: string;
  code: string | null;
  description: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  calculations: SerializedCalculation[];
  packages: SerializedGostPackage[];
}

export default function ProjectDetailClient({ project }: { project: SerializedProject }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    'calculations' | 'packages' | 'commercial' | 'settings'
  >('calculations');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [selectedCalcForVersion, setSelectedCalcForVersion] =
    useState<SerializedCalculation | null>(null);
  const [versionComment, setVersionComment] = useState('');
  const [versionName, setVersionName] = useState('');
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);

  // Edit project state
  const [editForm, setEditForm] = useState({
    name: project.name,
    customer: project.customer,
    code: project.code || '',
    description: project.description || '',
    status: project.status,
  });
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Latest calculation for commercial summary
  const latestCalc = project.calculations[0] || null;

  async function handleUpdateProject(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setIsSavingProject(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось обновить проект');
      }
      setIsEditModalOpen(false);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Ошибка обновления проекта');
    } finally {
      setIsSavingProject(false);
    }
  }

  function openCreateVersionModal(calc: SerializedCalculation) {
    setSelectedCalcForVersion(calc);
    setVersionName(`${calc.name} (v${calc.version + 1})`);
    setVersionComment(`Новая редакция на основе v${calc.version}`);
    setIsVersionModalOpen(true);
  }

  async function handleCreateVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCalcForVersion) return;
    setIsCreatingVersion(true);
    try {
      const res = await fetch(`/api/calculations/${selectedCalcForVersion.id}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: versionName,
          versionComment,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось создать версию расчёта');
      }
      const data = await res.json();
      setIsVersionModalOpen(false);
      router.push(`/calculations/${data.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка создания версии');
    } finally {
      setIsCreatingVersion(false);
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
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ УТВЕРЖДЁН
          </span>
        );
      case 'under_review':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            ⏳ НА СОГЛАСОВАНИИ
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            ✕ ОТКЛОНЁН
          </span>
        );
      case 'archived':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-nord-1 dark:text-nord-muted">
            📦 АРХИВ
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-nord-1 dark:text-nord-4">
            📝 ЧЕРНОВИК
          </span>
        );
    }
  };

  // Parse commercial summary for the latest calculation
  const commercial = latestCalc
    ? calculateCommercialSummary(latestCalc.stages, latestCalc.pmHours, latestCalc.risks, {
        currency: latestCalc.currency,
        roleRates: latestCalc.roleRates,
        overheadPercent: latestCalc.overheadPercent,
        marginPercent: latestCalc.marginPercent,
        discountPercent: latestCalc.discountPercent,
        vatPercent: latestCalc.vatPercent,
        includeVat: latestCalc.includeVat,
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-slate-500 dark:text-nord-muted">
        <Link href="/projects" className="hover:text-brand-600 dark:hover:text-nord-frost2">
          Проекты
        </Link>
        <span>/</span>
        <span className="font-semibold text-slate-900 dark:text-nord-5">{project.name}</span>
      </nav>

      {/* Project Hero Header */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-5 dark:border-nord-3 dark:from-nord-1/40 dark:to-nord-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                {project.code && (
                  <span className="rounded bg-brand-100 px-2 py-0.5 font-mono text-xs font-bold text-brand-800 dark:bg-nord-3 dark:text-nord-frost3">
                    {project.code}
                  </span>
                )}
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-nord-6">
                  {project.name}
                </h1>
                {getStatusBadge(project.status)}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                <span>
                  Заказчик:{' '}
                  <strong className="font-semibold text-slate-700 dark:text-nord-4">
                    {project.customer}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Создан:{' '}
                  {new Date(project.createdAt).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <span>•</span>
                <span>Автор: {project.createdBy}</span>
              </div>
              {project.description && (
                <p className="text-xs text-slate-600 dark:text-nord-4 max-w-3xl leading-relaxed pt-1">
                  {project.description}
                </p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/presale?projectId=${project.id}`}
                className="btn-primary !py-1.5 !px-3 text-xs"
              >
                <span>+</span>
                <span>Новый расчёт</span>
              </Link>
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="btn-secondary !py-1.5 !px-3 text-xs"
              >
                ✏️ Редактировать
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200/80 bg-white px-6 dark:border-nord-3 dark:bg-nord-2">
          <button
            onClick={() => setActiveTab('calculations')}
            className={`tab-btn ${activeTab === 'calculations' ? 'tab-btn-active' : ''}`}
          >
            <span>📊 Расчёты и версии ({project.calculations.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('packages')}
            className={`tab-btn ${activeTab === 'packages' ? 'tab-btn-active' : ''}`}
          >
            <span>📑 Реестр ГОСТ 34 ({project.packages.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('commercial')}
            className={`tab-btn ${activeTab === 'commercial' ? 'tab-btn-active' : ''}`}
          >
            <span>💰 Коммерческая сводка</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`tab-btn ${activeTab === 'settings' ? 'tab-btn-active' : ''}`}
          >
            <span>⚙️ Настройки проекта</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Calculations & Versions */}
      {activeTab === 'calculations' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
                История версий смет и расчётов
              </h2>
              <p className="text-xs text-slate-500 dark:text-nord-muted">
                Все ревизии трудозатрат проекта. Каждая версия сохраняет снимок этапов, рисков и
                параметров КП.
              </p>
            </div>
            <Link
              href={`/presale?projectId=${project.id}`}
              className="btn-secondary !py-1.5 !px-3 text-xs"
            >
              + Создать расчёт с нуля
            </Link>
          </div>

          {project.calculations.length === 0 ? (
            <div className="card p-10 text-center">
              <div className="text-2xl mb-2">📊</div>
              <h3 className="font-semibold text-slate-800 dark:text-nord-5">
                В этом проекте ещё нет расчётов
              </h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto dark:text-nord-muted">
                Создайте первый расчёт трудозатрат через интерфейс пресейла.
              </p>
              <div className="mt-4">
                <Link href={`/presale?projectId=${project.id}`} className="btn-primary text-xs">
                  Создать расчёт
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {project.calculations.map((calc, idx) => {
                const stageHours = calc.stages
                  .filter((s) => !s.isApprovalTask)
                  .reduce((sum, s) => sum + s.hours, 0);
                const riskHours = calc.risks.reduce((sum, r) => sum + r.hours, 0);
                const totalHours = stageHours + calc.pmHours + riskHours;
                const isLatest = idx === 0;

                return (
                  <div
                    key={calc.id}
                    className={`card p-5 transition-all ${
                      isLatest
                        ? 'border-brand-200 shadow-sm dark:border-nord-frost4/40'
                        : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white dark:bg-nord-frost4 dark:text-nord-0">
                            v{calc.version}
                          </span>
                          <Link
                            href={`/calculations/${calc.id}`}
                            className="text-base font-bold text-slate-900 hover:text-brand-600 dark:text-nord-6 dark:hover:text-nord-frost2"
                          >
                            {calc.name}
                          </Link>
                          {isLatest && (
                            <span className="rounded bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-nord-3 dark:text-nord-frost3">
                              ТЕКУЩАЯ
                            </span>
                          )}
                          <StatusBadge status={calc.status} />
                        </div>

                        {calc.versionComment && (
                          <p className="text-xs text-slate-600 dark:text-nord-4 italic">
                            💬 {calc.versionComment}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                          <span>
                            Шаблон:{' '}
                            <strong className="text-slate-700 dark:text-nord-4">
                              {calc.template.name}
                            </strong>
                          </span>
                          <span>•</span>
                          <span>Старт: {new Date(calc.startDate).toLocaleDateString('ru-RU')}</span>
                          <span>•</span>
                          <span>
                            Обновлён: {new Date(calc.updatedAt).toLocaleDateString('ru-RU')}
                          </span>
                          <span>•</span>
                          <span>Автор: {calc.createdBy}</span>
                        </div>
                      </div>

                      <div className="flex flex-col sm:items-end gap-2">
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-extrabold tabular-nums text-slate-900 dark:text-nord-6">
                            {totalHours}
                          </span>
                          <span className="text-xs font-medium text-slate-500">чел·ч</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-nord-muted">
                          <span>Этапы: {stageHours} ч</span>
                          <span>+</span>
                          <span>РП: {calc.pmHours} ч</span>
                          {riskHours > 0 && (
                            <>
                              <span>+</span>
                              <span className="text-amber-600 dark:text-nord-yellow">
                                Риски: {riskHours} ч
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <Link
                            href={`/calculations/${calc.id}`}
                            className="btn-primary !py-1 !px-2.5 text-xs"
                          >
                            Хаб расчёта →
                          </Link>
                          <button
                            onClick={() => openCreateVersionModal(calc)}
                            className="btn-secondary !py-1 !px-2.5 text-xs"
                            title="Создать версию N+1 на основе этой сметы"
                          >
                            🔄 Новая версия
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Released GOST 34 Packages */}
      {activeTab === 'packages' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
                Реестр комплектов документов ГОСТ 34
              </h2>
              <p className="text-xs text-slate-500 dark:text-nord-muted">
                Официальные выпуски ТЗ, ПМИ, ТП и сопутствующих документов с фиксацией профиля и
                контрольных сумм.
              </p>
            </div>
            {latestCalc && (
              <Link
                href={`/calculations/${latestCalc.id}`}
                className="btn-secondary !py-1.5 !px-3 text-xs"
              >
                + Выпустить комплект в мастере
              </Link>
            )}
          </div>

          {project.packages.length === 0 ? (
            <div className="card p-10 text-center">
              <div className="text-2xl mb-2">📑</div>
              <h3 className="font-semibold text-slate-800 dark:text-nord-5">
                Комплекты ГОСТ 34 ещё не выпускались
              </h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto dark:text-nord-muted">
                Откройте любой расчёт проекта и запустите мастер выпуска комплекта ГОСТ 34.
              </p>
              {latestCalc && (
                <div className="mt-4">
                  <Link href={`/calculations/${latestCalc.id}`} className="btn-primary text-xs">
                    Перейти в расчёт
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {project.packages.map((pkg) => {
                const docTypes = safeJsonParse<string[]>(pkg.documentTypes, ['tz']);

                return (
                  <div key={pkg.id} className="card p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-brand-700 dark:text-nord-frost3">
                            v{pkg.version}
                          </span>
                          <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
                            {pkg.name}
                          </h3>
                          {getPackageStatusBadge(pkg.status)}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-slate-500 dark:text-nord-muted">
                            Документы:
                          </span>
                          {docTypes.map((dt) => (
                            <span
                              key={dt}
                              className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-700 dark:bg-nord-1 dark:text-nord-4"
                            >
                              {dt}
                            </span>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                          <span>
                            Профиль:{' '}
                            <strong className="text-slate-700 dark:text-nord-4">
                              {pkg.standardProfileId} ({pkg.standardProfileVersion})
                            </strong>
                          </span>
                          <span>•</span>
                          <span>Генератор: {pkg.generatorVersion}</span>
                          <span>•</span>
                          <span>
                            Выпущен:{' '}
                            {new Date(pkg.createdAt).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </span>
                        </div>

                        {pkg.checksum && (
                          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 dark:text-nord-muted">
                            <span>SHA-256:</span>
                            <span className="truncate max-w-md bg-slate-100 px-1.5 py-0.5 rounded dark:bg-nord-1">
                              {pkg.checksum}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col sm:items-end gap-2">
                        {pkg.calculation && (
                          <div className="text-xs text-slate-500 dark:text-nord-muted">
                            Привязан к расчёту:{' '}
                            <Link
                              href={`/calculations/${pkg.calculation.id}`}
                              className="font-bold text-brand-700 hover:underline dark:text-nord-frost2"
                            >
                              v{pkg.calculation.version} ({pkg.calculation.name})
                            </Link>
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <Link
                            href={`/calculations/${pkg.calculationId}`}
                            className="btn-primary !py-1 !px-2.5 text-xs"
                          >
                            Открыть в хабе →
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Commercial Summary */}
      {activeTab === 'commercial' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
                Коммерческая сводка проекта
              </h2>
              <p className="text-xs text-slate-500 dark:text-nord-muted">
                Финансовый расчёт стоимости, накладных расходов, маржи и налогов по текущей смете.
              </p>
            </div>
            {latestCalc && (
              <Link
                href={`/calculations/${latestCalc.id}`}
                className="btn-secondary !py-1.5 !px-3 text-xs"
              >
                Перейти к настройке ставок →
              </Link>
            )}
          </div>

          {commercial ? (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
                  Структура трудозатрат
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-nord-3 text-sm">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600 dark:text-nord-4">Трудозатраты этапов</span>
                    <span className="font-bold">{commercial.stagesHours} ч</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600 dark:text-nord-4">
                      Управление проектом (РП)
                    </span>
                    <span className="font-bold">{commercial.pmHours} ч</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600 dark:text-nord-4">Рисковый резерв</span>
                    <span className="font-bold">{commercial.riskHours} ч</span>
                  </div>
                  <div className="flex justify-between py-2.5 font-bold text-base bg-slate-50 px-2 rounded dark:bg-nord-1">
                    <span>Всего трудозатрат</span>
                    <span className="text-brand-700 dark:text-nord-frost2">
                      {commercial.directLaborHours} ч
                    </span>
                  </div>
                </div>
              </div>

              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
                  Финансовая калькуляция
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-nord-3 text-sm">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600 dark:text-nord-4">Себестоимость труда</span>
                    <span className="font-bold font-mono">
                      {formatCurrency(commercial.directLaborCost, commercial.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600 dark:text-nord-4">
                      Накладные расходы ({commercial.overheadPercent}%)
                    </span>
                    <span className="font-mono">
                      {formatCurrency(commercial.overheadAmount, commercial.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600 dark:text-nord-4">
                      Плановая маржа ({commercial.marginPercent}%)
                    </span>
                    <span className="font-mono text-emerald-600 dark:text-nord-green">
                      +{formatCurrency(commercial.marginAmount, commercial.currency)}
                    </span>
                  </div>
                  {commercial.discountPercent > 0 && (
                    <div className="flex justify-between py-2 text-rose-600 dark:text-nord-redText">
                      <span>Скидка ({commercial.discountPercent}%)</span>
                      <span className="font-mono">
                        -{formatCurrency(commercial.discountAmount, commercial.currency)}
                      </span>
                    </div>
                  )}
                  {commercial.vatAmount > 0 && (
                    <div className="flex justify-between py-2">
                      <span className="text-slate-600 dark:text-nord-4">
                        НДС ({commercial.vatPercent}%)
                      </span>
                      <span className="font-mono">
                        {formatCurrency(commercial.vatAmount, commercial.currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between py-3 font-extrabold text-lg bg-emerald-50 px-3 rounded text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <span>Итоговое КП для заказчика</span>
                    <span className="font-mono">
                      {formatCurrency(commercial.grandTotal, commercial.currency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center text-slate-500">
              Нет данных расчёта для формирования коммерческой сводки.
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Settings */}
      {activeTab === 'settings' && (
        <div className="card p-6 max-w-2xl space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Параметры и реквизиты проекта
            </h2>
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              Управление метаданными проекта, шифром и статусом согласования.
            </p>
          </div>

          <form onSubmit={handleUpdateProject} className="space-y-4">
            {saveError && (
              <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {saveError}
              </div>
            )}

            <div>
              <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                Название проекта *
              </label>
              <input
                type="text"
                required
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="input text-sm"
              />
            </div>

            <div>
              <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                Заказчик *
              </label>
              <input
                type="text"
                required
                value={editForm.customer}
                onChange={(e) => setEditForm({ ...editForm, customer: e.target.value })}
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
                  value={editForm.code}
                  onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                  placeholder="PRJ-2026-001"
                  className="input text-sm font-mono uppercase"
                />
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Статус
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
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
                Описание проекта
              </label>
              <textarea
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="input text-sm"
              />
            </div>

            <div className="pt-2">
              <button type="submit" disabled={isSavingProject} className="btn-primary text-xs">
                {isSavingProject ? 'Сохранение...' : 'Сохранить изменения'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Project Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="card w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
                  Редактировать проект
                </h3>
                <p className="text-xs text-slate-500 dark:text-nord-muted">
                  Изменение реквизитов и статуса проекта
                </p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateProject} className="p-6 space-y-4">
              {saveError && (
                <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {saveError}
                </div>
              )}

              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Название проекта *
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="input text-sm"
                />
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Заказчик *
                </label>
                <input
                  type="text"
                  required
                  value={editForm.customer}
                  onChange={(e) => setEditForm({ ...editForm, customer: e.target.value })}
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
                    value={editForm.code}
                    onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                    placeholder="PRJ-2026-001"
                    className="input text-sm font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                    Статус
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
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
                  Описание проекта
                </label>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="input text-sm"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-nord-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Отмена
                </button>
                <button type="submit" disabled={isSavingProject} className="btn-primary text-xs">
                  {isSavingProject ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Version Modal */}
      {isVersionModalOpen && selectedCalcForVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="card w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
                  Создать версию расчёта (v{selectedCalcForVersion.version + 1})
                </h3>
                <p className="text-xs text-slate-500 dark:text-nord-muted">
                  Клонирование сметы с сохранением этапов и рисков
                </p>
              </div>
              <button
                onClick={() => setIsVersionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateVersion} className="p-6 space-y-4">
              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Название версии
                </label>
                <input
                  type="text"
                  required
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  className="input text-sm"
                />
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                  Комментарий к версии
                </label>
                <textarea
                  rows={2}
                  value={versionComment}
                  onChange={(e) => setVersionComment(e.target.value)}
                  placeholder="например, Оптимистичный сценарий без рискового буфера"
                  className="input text-sm"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-nord-3">
                <button
                  type="button"
                  onClick={() => setIsVersionModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Отмена
                </button>
                <button type="submit" disabled={isCreatingVersion} className="btn-primary text-xs">
                  {isCreatingVersion ? 'Создание...' : 'Создать версию'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
