import type { Gost34StageItem } from '../types';
import type { ContextGap, DeploymentModel, ProjectContext } from './types';

function hasManualProvenance(context: ProjectContext, path: string): boolean {
  return (context.provenance || []).some((item) => item.path === path && item.source === 'manual');
}

function upsertGap(gaps: ContextGap[], gap: ContextGap): void {
  if (!gaps.some((item) => item.path === gap.path)) gaps.push(gap);
}

function removeGap(gaps: ContextGap[], ...paths: string[]): ContextGap[] {
  const set = new Set(paths);
  return gaps.filter((gap) => !set.has(gap.path));
}

function resolveDeploymentModel(context: ProjectContext): DeploymentModel | undefined {
  const topLevel = context.deploymentModel;
  const infrastructure = context.infrastructure?.deploymentModel;

  // Manual overrides must win over values inferred from the questionnaire.
  if (hasManualProvenance(context, 'deploymentModel') && topLevel) return topLevel;
  if (hasManualProvenance(context, 'infrastructure') && infrastructure) return infrastructure;

  // Infrastructure is the canonical representation for generated documents.
  return infrastructure ?? topLevel;
}

/**
 * Final consistency pass before document generation.
 *
 * The ProjectContext builder intentionally collects data from heterogeneous
 * sources. This function resolves compatibility mirrors and adds generation-
 * critical gaps without mutating the stored/source context.
 */
export function normalizeProjectContextForGeneration(
  context: ProjectContext,
  stages: Gost34StageItem[] = []
): ProjectContext {
  const normalized: ProjectContext = {
    ...context,
    architecture: context.architecture ? { ...context.architecture } : undefined,
    infrastructure: context.infrastructure ? { ...context.infrastructure } : undefined,
    lifecycle: context.lifecycle ? { ...context.lifecycle } : undefined,
    provenance: [...(context.provenance || [])],
    gaps: [...(context.gaps || [])],
  };

  const deploymentModel = resolveDeploymentModel(context);
  if (deploymentModel) {
    normalized.deploymentModel = deploymentModel;
    normalized.infrastructure = {
      ...(normalized.infrastructure || {}),
      deploymentModel,
    };
    normalized.gaps = removeGap(
      normalized.gaps || [],
      'deploymentModel',
      'infrastructure.deploymentModel'
    );
  }

  if (stages.length > 0) {
    const lifecycle = {
      ...(normalized.lifecycle || {}),
      stages: normalized.lifecycle?.stages?.length
        ? normalized.lifecycle.stages
        : stages.map((stage) => stage.name),
      startDate: normalized.lifecycle?.startDate ?? stages[0]?.startDate,
      endDate: normalized.lifecycle?.endDate ?? stages[stages.length - 1]?.endDate,
    };
    normalized.lifecycle = lifecycle;

    const gaps = normalized.gaps || [];
    if (!lifecycle.startDate) {
      upsertGap(gaps, {
        path: 'lifecycle.startDate',
        label: 'Плановая дата начала работ',
        severity: 'major',
        hint: 'Календарный план проекта или согласованный график работ',
      });
    } else {
      normalized.gaps = removeGap(gaps, 'lifecycle.startDate');
    }

    const effectiveGaps = normalized.gaps || gaps;
    if (!lifecycle.endDate) {
      upsertGap(effectiveGaps, {
        path: 'lifecycle.endDate',
        label: 'Плановая дата окончания работ',
        severity: 'major',
        hint: 'Календарный план проекта или согласованный график работ',
      });
    } else {
      normalized.gaps = removeGap(effectiveGaps, 'lifecycle.endDate');
    }

    if (!normalized.gaps) normalized.gaps = effectiveGaps;
  }

  return normalized;
}
