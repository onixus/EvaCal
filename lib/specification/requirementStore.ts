import { getGostPackageStudioState } from '../project';
import { parsePackageSnapshot } from '../gost34/diff';
import { requirementOptionsFromSnapshot, type RequirementOptions } from './requirements';

/**
 * Требования, на которые ссылаются позиции спецификации: черновик студии, если он
 * не старше последнего комплекта, иначе последний комплект расчета (тот же выбор
 * базы, что у студии ГОСТ 34).
 */
export async function loadRequirementOptions(calculationId: string): Promise<RequirementOptions> {
  const { draft, latestPackage } = await getGostPackageStudioState(calculationId);
  const pkg =
    draft && (!latestPackage || draft.version >= latestPackage.version)
      ? draft
      : (latestPackage ?? draft);
  if (!pkg) return { source: null, requirements: [] };
  return {
    source: {
      kind: pkg.status === 'draft' ? 'draft' : 'package',
      packageId: pkg.id,
      version: pkg.version,
      status: pkg.status,
    },
    requirements: requirementOptionsFromSnapshot(parsePackageSnapshot(pkg)),
  };
}
