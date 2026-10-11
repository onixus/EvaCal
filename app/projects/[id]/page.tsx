import { notFound } from 'next/navigation';
import { getProjectDetails } from '@/lib/project';
import { getSession } from '@/lib/auth';
import { projectSchedule } from '@/lib/schedule';
import { tryProfitForecast } from '@/lib/actuals';
import { loadSupply } from '@/lib/commercialContourData';
import { resolveLifecycle } from '@/lib/lifecycle';
import { lifecycleInputFromRow, loadLifecycleReviewContext } from '@/lib/lifecycleData';
import { loadChangeSummary } from '@/lib/changeRequests/summaryData';
import ProjectDetailClient from './ProjectDetailClient';
import type { SerializedProject } from './project-detail/types';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await props.params;
  // Ссылки из уведомлений и очереди открывают нужную вкладку (?tab=changes).
  const initialTab = (await props.searchParams)?.tab;
  const [project, session] = await Promise.all([getProjectDetails(params.id), getSession()]);

  if (!project) {
    notFound();
  }
  const canEditDeal = ['presale', 'architect', 'admin'].includes(session?.role ?? '');
  // Первоначальная база и согласованные изменения (#103 §1.4).
  const changeSummary = await loadChangeSummary(project);

  const latestCalculation = project.calculations[0];
  const latestSupply = latestCalculation
    ? await loadSupply(latestCalculation).then(
        (supply) => ({ supply, supplyError: null }),
        (error: unknown) => ({
          supply: null,
          supplyError: error instanceof Error ? error.message : 'Поставка не рассчитана',
        }),
      )
    : {};

  const serializedProject: SerializedProject = {
    id: project.id,
    name: project.name,
    customer: project.customer,
    code: project.code,
    description: project.description,
    status: project.status,
    createdBy: project.createdBy,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    changeSummary,
    deal: {
      id: project.id,
      dealStatus: project.dealStatus,
      dealClosedAt: project.dealClosedAt?.toISOString() ?? null,
      dealClosedBy: project.dealClosedBy,
      lossReason: project.lossReason,
      lossComment: project.lossComment,
      competitor: project.competitor,
      contractAmount: project.contractAmount,
      contractCurrency: project.contractCurrency,
      wonCalculationId: project.wonCalculationId,
      actualsClosedAt: project.actualsClosedAt?.toISOString() ?? null,
      schedule: (() => {
        const won = project.calculations.find((c) => c.id === project.wonCalculationId);
        if (project.dealStatus !== 'won' || !won) return null;
        const s = projectSchedule(won.stages);
        return s
          ? {
              status: s.status,
              plannedEnd: s.plannedEnd,
              forecastEnd: s.forecastEnd,
              currentSlipDays: s.currentSlipDays,
              done: s.done,
              total: s.total,
              overdue: s.overdue,
            }
          : null;
      })(),
      forecast: (() => {
        const won = project.calculations.find((c) => c.id === project.wonCalculationId);
        if (project.dealStatus !== 'won' || !won) return null;
        const f = tryProfitForecast({
          stages: won.stages,
          risks: won.risks,
          pmHours: won.pmHours,
          actualPmHours: won.actualPmHours,
          remainingPmHoursEstimate: won.remainingPmHoursEstimate,
          remainingPmActualBaseline: won.remainingPmActualBaseline,
          terms: won,
          contractAmount: project.contractAmount,
          contractCurrency: project.contractCurrency,
        });
        if ('error' in f) return { error: f.error };
        return {
          currency: f.currency,
          partial: f.partial,
          incomplete: f.incomplete,
          profit: f.profit,
          profitUpperBound: f.profitUpperBound,
          marginPercent: f.marginPercent,
          forecastCost: f.forecastCost,
          knownCost: f.knownCost,
          revenueSource: f.revenueSource,
          currencyMismatch: f.currencyMismatch,
        };
      })(),
      calculations: project.calculations.map((c) => ({
        id: c.id,
        version: c.version,
        status: c.status,
        currency: c.currency,
        stagesTotal: c.stages.filter((s) => !s.isApprovalTask).length,
        stagesWithActual: c.stages.filter((s) => !s.isApprovalTask && s.actualHours !== null)
          .length,
      })),
    },
    calculations: project.calculations.map((c, index) => ({
      id: c.id,
      name: c.name,
      customer: c.customer,
      version: c.version,
      status: c.status,
      versionComment: c.versionComment,
      startDate: c.startDate.toISOString(),
      pmHours: c.pmHours,
      createdBy: c.createdBy,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      template: {
        id: c.template?.id || '',
        name: c.template?.name || 'Шаблон',
      },
      stages: c.stages.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        hours: s.hours,
        isApprovalTask: s.isApprovalTask,
        order: s.order,
      })),
      risks: c.risks.map((r) => ({
        id: r.id,
        description: r.description,
        hours: r.hours,
        order: r.order,
      })),
      currency: c.currency,
      roleRates: c.roleRates,
      overheadPercent: c.overheadPercent,
      pricingMode: c.pricingMode,
      marginPercent: c.marginPercent,
      discountPercent: c.discountPercent,
      vatPercent: c.vatPercent,
      includeVat: c.includeVat,
      standardProfileId: c.standardProfileId,
      standardProfileVersion: c.standardProfileVersion,
      generatorVersion: c.generatorVersion,
      // #103 §4.2: поставка и статьи — только у текущей версии (коммерческая сводка).
      ...(index === 0 ? latestSupply : {}),
    })),
    packages: project.packages.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      status: p.status,
      calculationId: p.calculationId,
      calculation: p.calculation,
      standardProfileId: p.standardProfileId,
      standardProfileVersion: p.standardProfileVersion,
      generatorVersion: p.generatorVersion,
      documentTypes: p.documentTypes,
      metadata: p.metadata,
      artifactPath: p.artifactPath,
      hasArtifact: Boolean(p.artifactPath),
      checksum: p.checksum,
      releasedAt: p.releasedAt ? p.releasedAt.toISOString() : null,
      releasedBy: p.releasedBy,
      approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
      approvedBy: p.approvedBy,
      reviewStage: p.reviewStage,
      reviewComment: p.reviewComment,
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  };

  // Списки уже отсортированы по версии вниз — первый элемент и есть текущий.
  // Для задержавшегося комплекта видны причина, ответственный и следующий шаг (#103).
  const review = await loadLifecycleReviewContext(project.packages.slice(0, 1));
  const lifecycle = resolveLifecycle(lifecycleInputFromRow(project, review));

  return (
    <ProjectDetailClient
      project={serializedProject}
      lifecycle={lifecycle}
      canEditDeal={canEditDeal}
      sessionRole={session?.role ?? null}
      initialTab={initialTab}
    />
  );
}
