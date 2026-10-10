import { prisma } from './prisma';
import {
  carryDependencies,
  expandWithApprovals,
  matchStageRows,
  scheduleItems,
  PrimaryStageInput,
  ScheduleConfig,
  DEFAULT_SCHEDULE_CONFIG,
} from './scheduling';
import { computePmHours } from './pm';
import { loadScheduleConfig } from './calendarData';
import { lockCalculationLedger } from './actualsLedgerData';

/**
 * Перестраивает план этапов расчёта по упорядоченному списку основных этапов
 * **на месте**: прежние строки Stage сопоставляются с новым планом
 * (`matchStageRows`: id из редактора, иначе название + роль + позиция) и
 * обновляются, новые создаются, удаляются только этапы, которых больше нет.
 * Поэтому факт этапа, записи журнала факта (ActualEntry), сопоставления задач
 * трекера и явные зависимости (#103 WP-5e) переживают правку списка этапов и
 * перенос даты старта.
 *
 * У удалённого этапа записи журнала остаются с `stageId = null` (FK SetNull —
 * журнал это поддерживает: часы видны как несопоставленные и могут быть
 * сопоставлены заново); сопоставления задач этого этапа удаляются каскадом.
 * Агрегат факта сохранённых этапов не меняется: их записи журнала не трогаются.
 * Зависимость, ставшая «обратной» после перестановки, снимается.
 */
export async function rebuildStages(
  calculationId: string,
  primary: PrimaryStageInput[],
  startDate: Date,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
) {
  const items = expandWithApprovals(primary);
  await prisma.$transaction(
    async (tx) => {
      // Блокировка расчёта (та же, что у журнала факта, правки зависимостей и
      // apply) берётся до чтения: этапы и зависимости читаются и пишутся под
      // ней, параллельная правка не увидит промежуточного состояния и не
      // затрёт эту.
      await lockCalculationLedger(tx, calculationId);
      const oldStages = await tx.stage.findMany({
        where: { calculationId },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, role: true, isApprovalTask: true },
      });
      const oldDeps = await tx.stageDependency.findMany({
        where: { calculationId },
        select: { fromStageId: true, toStageId: true, lagDays: true },
      });
      const matched = matchStageRows(primary, items, oldStages);
      const dependencies = carryDependencies(items, matched, oldDeps);
      const scheduled = scheduleItems(items, startDate, config, dependencies);
      const kept = new Set(matched.filter((id): id is string => Boolean(id)));
      const removed = oldStages.filter((s) => !kept.has(s.id)).map((s) => s.id);

      await tx.stageDependency.deleteMany({ where: { calculationId } });
      if (removed.length > 0) {
        await tx.stage.deleteMany({ where: { calculationId, id: { in: removed } } });
      }
      const ids: string[] = [];
      for (const [i, item] of scheduled.entries()) {
        const data = {
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
        };
        const id = matched[i];
        if (id) {
          await tx.stage.update({ where: { id }, data });
          ids.push(id);
        } else {
          const row = await tx.stage.create({
            data: { calculationId, ...data },
            select: { id: true },
          });
          ids.push(row.id);
        }
      }
      if (dependencies.length > 0) {
        await tx.stageDependency.createMany({
          data: dependencies.map((d) => ({
            calculationId,
            fromStageId: ids[d.from],
            toStageId: ids[d.to],
            type: 'FS',
            lagDays: d.lagDays,
          })),
        });
      }
    },
    { timeout: 30_000 },
  );

  return prisma.stage.findMany({
    where: { calculationId },
    orderBy: { order: 'asc' },
  });
}

/**
 * Настройки Ганта шаблона вместе с его производственным календарём (#103 WP-5d):
 * календарь шаблона, иначе календарь по умолчанию — тот же, что читает ресурсный план.
 */
export async function scheduleConfigFromTemplate(template: {
  workDayHours: number;
  includeWeekends: boolean;
  calendarId?: string | null;
}): Promise<ScheduleConfig> {
  return loadScheduleConfig(template);
}

/** РП isn't a stage — this computes the scalar hours to store on Calculation.pmHours. */
export function pmHoursFor(
  fields: { key: string; type: string }[],
  answers: Record<string, unknown>,
  primary: PrimaryStageInput[],
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
  answers: Record<string, unknown>,
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
  riskTemplates: { description: string; hours: number; order: number }[],
): { description: string; hours: number; order: number }[] {
  return [...riskTemplates]
    .sort((a, b) => a.order - b.order)
    .map((rt) => ({
      description: rt.description,
      hours: rt.hours,
      order: rt.order,
    }));
}
