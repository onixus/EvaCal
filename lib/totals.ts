import { totalLaborHours } from './scheduling';

/** Grand total labor hours = real stages + РП allowance + flagged risks. Nothing here is a Gantt row. */
export function grandTotalHours(
  stages: { hours: number; isApprovalTask: boolean }[],
  pmHours: number,
  risks: { hours: number }[],
): number {
  return totalLaborHours(stages) + pmHours + risks.reduce((sum, r) => sum + r.hours, 0);
}

export function risksTotalHours(risks: { hours: number }[]): number {
  return risks.reduce((sum, r) => sum + r.hours, 0);
}
