import { prisma } from "./prisma";
import {
  expandWithApprovals,
  scheduleItems,
  PrimaryStageInput,
  ScheduleConfig,
  DEFAULT_SCHEDULE_CONFIG,
} from "./scheduling";
import { computePmHours } from "./pm";

/** Wipes and regenerates every Stage row for a calculation from an ordered list of primary stages. */
export async function rebuildStages(
  calculationId: string,
  primary: PrimaryStageInput[],
  startDate: Date,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG
) {
  const scheduled = scheduleItems(expandWithApprovals(primary), startDate, config);

  await prisma.stage.deleteMany({ where: { calculationId } });

  if (scheduled.length === 0) return [];

  await prisma.$transaction(
    scheduled.map((item) =>
      prisma.stage.create({
        data: {
          calculationId,
          name: item.name,
          role: item.role,
          hours: item.hours,
          order: item.order,
          startDate: item.startDate,
          endDate: item.endDate,
          isApprovalTask: item.isApprovalTask,
          dueDate: item.dueDate,
          requirements: item.requirements,
          parallel: item.parallel,
          approvalDays: item.approvalDays,
        },
      })
    )
  );

  return prisma.stage.findMany({ where: { calculationId }, orderBy: { order: "asc" } });
}

export function scheduleConfigFromTemplate(template: { workDayHours: number; includeWeekends: boolean }): ScheduleConfig {
  return { workDayHours: template.workDayHours, includeWeekends: template.includeWeekends };
}

/** РП isn't a stage — this computes the scalar hours to store on Calculation.pmHours. */
export function pmHoursFor(
  fields: { key: string; type: string }[],
  answers: Record<string, unknown>,
  primary: PrimaryStageInput[]
): number {
  const otherHours = primary.reduce((sum, s) => sum + s.hours, 0);
  return computePmHours(fields, answers, otherHours);
}

export function primaryStagesFromTemplate(
  stageTemplates: {
    name: string;
    role: string;
    baseHours: number;
    hoursPerUnit: number;
    driverFieldKey: string | null;
    requirements?: string | null;
    order: number;
  }[],
  answers: Record<string, unknown>
): PrimaryStageInput[] {
  return [...stageTemplates]
    .sort((a, b) => a.order - b.order)
    .map((st) => {
      const driverValue = st.driverFieldKey ? Number(answers[st.driverFieldKey] ?? 0) || 0 : 0;
      return {
        name: st.name,
        role: st.role,
        hours: Math.max(0, st.baseHours + st.hoursPerUnit * driverValue),
        requirements: st.requirements ?? null,
      };
    });
}

/** Turns an admin's default RiskTemplate rows into Risk create-input for a new calculation. */
export function risksFromTemplate(
  riskTemplates: { description: string; hours: number; order: number }[]
): { description: string; hours: number; order: number }[] {
  return [...riskTemplates]
    .sort((a, b) => a.order - b.order)
    .map((rt) => ({ description: rt.description, hours: rt.hours, order: rt.order }));
}
