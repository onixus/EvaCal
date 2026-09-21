'use client';

import { useState } from 'react';
import Link from 'next/link';
import DealPanel from '@/components/DealPanel';
import PipelineStepper from '@/components/lifecycle/PipelineStepper';
import type { LifecycleState } from '@/lib/lifecycle';
import CalculationsTab from './project-detail/CalculationsTab';
import PackagesTab from './project-detail/PackagesTab';
import CommercialTab from './project-detail/CommercialTab';
import ProjectSettingsPanel from './project-detail/ProjectSettingsPanel';
import ProjectEditModal from './project-detail/ProjectEditModal';
import CreateVersionModal from './project-detail/CreateVersionModal';
import PackageReviewModal from './project-detail/PackageReviewModal';
import ShareReviewModal from './project-detail/ShareReviewModal';
import PackageDiffModal from './project-detail/PackageDiffModal';
import { ProjectStatusBadge } from './project-detail/StatusBadges';
import type {
  SerializedCalculation,
  SerializedGostPackage,
  SerializedProject,
} from './project-detail/types';

export type {
  SerializedStage,
  SerializedRisk,
  SerializedCalculation,
  SerializedGostPackage,
  SerializedProject,
} from './project-detail/types';

type ActiveTab = 'calculations' | 'packages' | 'commercial' | 'settings';

interface ReviewRequest {
  pkg: SerializedGostPackage;
  decision: 'approve' | 'reject';
}

export default function ProjectDetailClient({
  project,
  lifecycle,
  canEditDeal = false,
  sessionRole = null,
}: {
  project: SerializedProject;
  lifecycle: LifecycleState;
  canEditDeal?: boolean;
  sessionRole?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('calculations');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [versionCalculation, setVersionCalculation] = useState<SerializedCalculation | null>(null);
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest | null>(null);
  const [sharePackage, setSharePackage] = useState<SerializedGostPackage | null>(null);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

  const latestCalculation = project.calculations[0] ?? null;

  return (
    <div className="page">
      <nav className="flex items-center gap-2 text-xs text-slate-500 dark:text-nord-muted">
        <Link href="/projects" className="hover:text-brand-600 dark:hover:text-nord-frost2">
          Проекты
        </Link>
        <span>/</span>
        <span className="font-semibold text-slate-900 dark:text-nord-5">{project.name}</span>
      </nav>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-nord-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                {project.code && (
                  <span className="rounded bg-brand-100 px-2 py-0.5 font-mono text-xs font-bold text-brand-800 dark:bg-nord-3 dark:text-nord-frost3">
                    {project.code}
                  </span>
                )}
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
                  {project.name}
                </h1>
                <ProjectStatusBadge status={project.status} />
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                <span>
                  Заказчик:{' '}
                  <strong className="font-semibold text-slate-700 dark:text-nord-4">
                    {project.customer}
                  </strong>
                </span>
                <span aria-hidden>·</span>
                <span>
                  Создан{' '}
                  {new Date(project.createdAt).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <span aria-hidden>·</span>
                <span>Автор: {project.createdBy}</span>
              </div>

              {project.description && (
                <p className="max-w-3xl text-xs leading-relaxed text-slate-600 dark:text-nord-4">
                  {project.description}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link href={`/presale?projectId=${project.id}`} className="btn-primary">
                + Новый расчёт
              </Link>
              <button onClick={() => setIsEditModalOpen(true)} className="btn-secondary">
                Редактировать
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-nord-3 dark:bg-nord-1/40">
          <PipelineStepper state={lifecycle} />
        </div>

        <div className="tab-bar border-b-0 bg-white px-3 dark:bg-nord-2">
          <button
            onClick={() => setActiveTab('calculations')}
            className={`tab-btn ${activeTab === 'calculations' ? 'tab-btn-active' : ''}`}
          >
            <span>Расчёты и версии ({project.calculations.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('packages')}
            className={`tab-btn ${activeTab === 'packages' ? 'tab-btn-active' : ''}`}
          >
            <span>Реестр ГОСТ 34 ({project.packages.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('commercial')}
            className={`tab-btn ${activeTab === 'commercial' ? 'tab-btn-active' : ''}`}
          >
            <span>Коммерческая сводка</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`tab-btn ${activeTab === 'settings' ? 'tab-btn-active' : ''}`}
          >
            <span>Настройки проекта</span>
          </button>
        </div>
      </div>

      <DealPanel project={project.deal} canEdit={canEditDeal} />

      {activeTab === 'calculations' && (
        <CalculationsTab
          projectId={project.id}
          calculations={project.calculations}
          onCreateVersion={setVersionCalculation}
        />
      )}

      {activeTab === 'packages' && (
        <PackagesTab
          packages={project.packages}
          latestCalculation={latestCalculation}
          sessionRole={sessionRole}
          onCompare={() => setIsDiffModalOpen(true)}
          onShare={setSharePackage}
          onReview={(pkg, decision) => setReviewRequest({ pkg, decision })}
        />
      )}

      {activeTab === 'commercial' && <CommercialTab calculation={latestCalculation} />}

      {activeTab === 'settings' && <ProjectSettingsPanel project={project} />}

      {isEditModalOpen && (
        <ProjectEditModal project={project} onClose={() => setIsEditModalOpen(false)} />
      )}

      {versionCalculation && (
        <CreateVersionModal
          calculation={versionCalculation}
          onClose={() => setVersionCalculation(null)}
        />
      )}

      {reviewRequest && (
        <PackageReviewModal
          pkg={reviewRequest.pkg}
          initialDecision={reviewRequest.decision}
          onClose={() => setReviewRequest(null)}
        />
      )}

      {sharePackage && (
        <ShareReviewModal pkg={sharePackage} onClose={() => setSharePackage(null)} />
      )}

      {isDiffModalOpen && (
        <PackageDiffModal
          projectId={project.id}
          packages={project.packages}
          onClose={() => setIsDiffModalOpen(false)}
        />
      )}
    </div>
  );
}
