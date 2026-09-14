/**
 * Выборка данных для калибровки из БД. Отделена от `lib/calibration.ts`, чтобы
 * саму логику похожести можно было тестировать без Prisma.
 */
import { prisma } from '@/lib/prisma';
import { safeJsonParse } from '@/lib/json';
import {
  buildCalibration,
  type CalibrationCalcRow,
  type CalibrationReport,
} from '@/lib/calibration';

/** Сколько последних утверждённых расчётов шаблона просматривать. */
const POOL_LIMIT = 200;

const calcSelect = {
  id: true,
  name: true,
  customer: true,
  projectId: true,
  version: true,
  status: true,
  answers: true,
  pmHours: true,
  updatedAt: true,
  stages: {
    select: {
      name: true,
      hours: true,
      isApprovalTask: true,
      startDate: true,
      endDate: true,
      actualHours: true,
    },
  },
  risks: { select: { hours: true } },
  project: { select: { dealStatus: true, wonCalculationId: true } },
} as const;

type RawCalc = {
  id: string;
  name: string;
  customer: string;
  projectId: string | null;
  version: number;
  status: string;
  answers: string;
  pmHours: number;
  updatedAt: Date;
  stages: {
    name: string;
    hours: number;
    isApprovalTask: boolean;
    startDate: Date;
    endDate: Date;
    actualHours: number | null;
  }[];
  risks: { hours: number }[];
  project: { dealStatus: string; wonCalculationId: string | null } | null;
};

function toRow(c: RawCalc): CalibrationCalcRow {
  const { project, ...rest } = c;
  return {
    ...rest,
    answers: safeJsonParse<Record<string, unknown>>(c.answers, {}),
    wonVersion: project?.dealStatus === 'won' && project.wonCalculationId === c.id,
  };
}

/**
 * Все версии одного расчёта: и предки, и потомки по parentCalculationId.
 *
 * Одним запросом берутся только пары (id, parent) по шаблону — это дёшево и
 * позволяет пройти цепочку в обе стороны в памяти. Отдельные запросы на каждое
 * звено дали бы N+1, а вывести цепочку из уже загруженных кандидатов нельзя:
 * промежуточная версия может быть черновиком и в выборку утверждённых не попасть.
 *
 * Обход с защитой от цикла: parentCalculationId задаётся приложением, но
 * рассчитывать на отсутствие петли в данных нельзя — зациклившийся обход
 * повесил бы запрос.
 */
async function lineageOf(calculationId: string, templateId: string): Promise<string[]> {
  const rows = await prisma.calculation.findMany({
    where: { templateId },
    select: { id: true, parentCalculationId: true },
  });

  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    parentOf.set(r.id, r.parentCalculationId);
    if (r.parentCalculationId) {
      const siblings = childrenOf.get(r.parentCalculationId) ?? [];
      siblings.push(r.id);
      childrenOf.set(r.parentCalculationId, siblings);
    }
  }

  // Вверх до корня, затем вниз по всем потомкам корня — так в набор попадают
  // и «братья»: версии, отпочковавшиеся от общего предка.
  const seen = new Set<string>([calculationId]);
  let root = calculationId;
  for (;;) {
    const parent = parentOf.get(root);
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    root = parent;
  }

  const queue = [root];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const child of childrenOf.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }

  return [...seen];
}

export async function loadCalibration(
  calculationId: string,
  revealIdentity: boolean,
): Promise<CalibrationReport | null> {
  const target = await prisma.calculation.findUnique({
    where: { id: calculationId },
    select: {
      ...calcSelect,
      templateId: true,
      template: {
        select: {
          fields: { select: { key: true, label: true, type: true, options: true } },
          stageTemplates: {
            select: {
              name: true,
              role: true,
              baseHours: true,
              hoursPerUnit: true,
              driverFieldKey: true,
              order: true,
            },
          },
        },
      },
    },
  });
  if (!target) return null;

  const candidates = await prisma.calculation.findMany({
    where: { templateId: target.templateId, status: 'approved', id: { not: target.id } },
    orderBy: { updatedAt: 'desc' },
    take: POOL_LIMIT,
    select: calcSelect,
  });

  return buildCalibration({
    target: toRow(target),
    fields: target.template.fields,
    stageTemplates: target.template.stageTemplates,
    candidates: candidates.map(toRow),
    revealIdentity,
    lineageIds: await lineageOf(target.id, target.templateId),
  });
}
