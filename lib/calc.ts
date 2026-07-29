import { prisma } from "./prisma";
import { expandWithApprovals, scheduleItems, PrimaryStageInput } from "./scheduling";

/** Wipes and regenerates every Stage row for a calculation from an ordered list of primary stages. */
export async function rebuildStages(calculationId: string, primary: PrimaryStageInput[], startDate: Date) {
  const scheduled = scheduleItems(expandWithApprovals(primary), startDate);

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
        },
      })
    )
  );

  return prisma.stage.findMany({ where: { calculationId }, orderBy: { order: "asc" } });
}

export function primaryStagesFromTemplate(
  stageTemplates: { name: string; role: string; baseHours: number; hoursPerUnit: number; driverFieldKey: string | null; order: number }[],
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
      };
    });
}
