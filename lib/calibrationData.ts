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
    select: { name: true, hours: true, isApprovalTask: true, startDate: true, endDate: true },
  },
  risks: { select: { hours: true } },
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
  }[];
  risks: { hours: number }[];
};

function toRow(c: RawCalc): CalibrationCalcRow {
  return { ...c, answers: safeJsonParse<Record<string, unknown>>(c.answers, {}) };
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
  });
}
