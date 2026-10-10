/**
 * CSV-импорт факта в журнал (#103 WP-6a): разбор, сопоставление с этапами,
 * правило ручных часов и синхронизация. Общий для маршрута импорта и
 * scripts/verify-actuals-sync.ts.
 */
import { prisma } from '@/lib/prisma';
import { parseActualsCsv } from '@/lib/actuals';
import {
  CSV_SOURCE,
  csvToLedgerEntries,
  manualHoursRule,
  type ManualHoursMode,
  type SyncMode,
} from '@/lib/actualsLedger';
import {
  applyTaskMappings,
  loadManualHours,
  loadTaskMappings,
  syncLedgerSource,
} from '@/lib/actualsLedgerData';

export interface ActualsCsvImportInput {
  calculationId: string;
  csv: string;
  mode: SyncMode;
  manualHours: ManualHoursMode;
  mappings: Record<string, string>;
  startedBy: string | null;
  dryRun: boolean;
}

export async function importActualsCsv(input: ActualsCsvImportInput) {
  const stages = await prisma.stage.findMany({
    where: { calculationId: input.calculationId },
    select: { id: true, name: true, isApprovalTask: true },
  });
  const ownStages = new Set(stages.filter((s) => !s.isApprovalTask).map((s) => s.id));
  if (Object.values(input.mappings).some((id) => !ownStages.has(id))) {
    return { ok: false as const, error: 'Сопоставление указывает на этап другого расчёта' };
  }
  const saved = await loadTaskMappings(input.calculationId, CSV_SOURCE);
  const parsed = parseActualsCsv(input.csv);
  const ledger = csvToLedgerEntries(parsed.rows, stages, { ...saved, ...input.mappings });

  // Этапы импорта с ручными часами и правило для каждого из них.
  const importStageIds = [...new Set(ledger.matched.map((m) => m.stageId))];
  const ruleOf = (id: string) =>
    manualHoursRule(input.manualHours, ledger.totalStageIds.includes(id));
  const manualByStage = await loadManualHours(input.calculationId, importStageIds);
  const nameOf = new Map(stages.map((s) => [s.id, s.name]));
  const manualStages = Object.entries(manualByStage).map(([stageId, h]) => ({
    stageId,
    name: nameOf.get(stageId) ?? stageId,
    manualHours: h.base,
    adjustmentHours: h.adjustment,
    rule: ruleOf(stageId),
  }));

  const sync = await syncLedgerSource({
    calculationId: input.calculationId,
    source: CSV_SOURCE,
    entries: ledger.entries,
    mode: input.mode,
    keepExternalIds: ledger.allExternalIds,
    startedBy: input.startedBy,
    errors: [
      ...parsed.invalid.map((line) => ({ kind: 'invalid', line })),
      ...ledger.unmatched.map((stage) => ({ kind: 'unmatched', stage })),
      ...ledger.ambiguous.map((stage) => ({ kind: 'ambiguous', stage })),
      ...ledger.unmappedTasks.map((task) => ({ kind: 'unmapped_task', task })),
    ],
    dryRun: input.dryRun,
    supersedeManualStageIds: importStageIds.filter((id) => ruleOf(id) === 'replace'),
    manualHoursMode: input.manualHours,
    // Сопоставления пишутся в той же транзакции, что и записи журнала.
    afterWrite: (tx) =>
      applyTaskMappings(tx, input.calculationId, CSV_SOURCE, input.mappings, input.startedBy),
  });

  return {
    ok: true as const,
    sync,
    report: {
      matched: ledger.matched,
      unmatched: ledger.unmatched,
      invalid: parsed.invalid,
      ambiguous: ledger.ambiguous,
      unmappedTasks: ledger.unmappedTasks,
      duplicateIds: ledger.duplicateIds,
      mode: input.mode,
      manualHours: input.manualHours,
      manualStages,
      counts: sync.counts,
      manualResetStages: sync.manualResetStageIds.map((id) => nameOf.get(id) ?? id),
      applied: !input.dryRun,
    },
  };
}
