/** Журнал факта (#103 WP-6a) на живой PostgreSQL: перенос факта миграцией,
 * повторный импорт без удвоения, исправления, политика полной выгрузки, CHECK.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { CSV_SOURCE, type ManualHoursMode, type SyncMode } from '../lib/actualsLedger';
import { recordManualStageEdit } from '../lib/actualsLedgerData';
import { importActualsCsv } from '../lib/actualsCsvImport';

const MIGRATION = path.join(
  __dirname,
  '../prisma/migrations/20261024100000_actuals_ledger/migration.sql',
);

/** Тот же INSERT … SELECT, что в миграции, ограниченный тестовым расчётом. */
async function runBackfill(calculationId: string) {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('INSERT INTO "ActualEntry"');
  assert(start >= 0, 'в миграции есть перенос факта');
  const stmt = sql.slice(start, sql.indexOf(';', start));
  await prisma.$executeRawUnsafe(`${stmt} AND "calculationId" = $1`, calculationId);
}

async function main() {
  const template = await prisma.formTemplate.create({ data: { name: `actuals-${randomUUID()}` } });
  const day = (s: string) => new Date(`${s}T00:00:00Z`);
  try {
    const calc = await prisma.calculation.create({
      data: {
        templateId: template.id,
        name: 'Журнал факта',
        customer: 'CI',
        answers: '{}',
        status: 'approved',
        stages: {
          create: [
            {
              name: 'Обследование',
              role: 'analyst',
              hours: 10,
              order: 0,
              startDate: day('2026-03-01'),
              endDate: day('2026-03-05'),
              // Факт, внесённый до журнала: должен пережить миграцию.
              actualHours: 120,
              actualStartDate: day('2026-03-02'),
            },
            {
              name: 'Проектирование',
              role: 'architect',
              hours: 20,
              order: 1,
              startDate: day('2026-03-06'),
              endDate: day('2026-03-20'),
            },
            {
              name: 'Анализ',
              role: 'analyst',
              hours: 40,
              order: 2,
              startDate: day('2026-03-01'),
              endDate: day('2026-03-20'),
              // Итог, загруженный старым CSV-импортом (он перезаписывал этап).
              actualHours: 40,
            },
            {
              name: 'Тестирование',
              role: 'tester',
              hours: 40,
              order: 3,
              startDate: day('2026-03-01'),
              endDate: day('2026-03-20'),
            },
          ],
        },
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    const [s1, s2, s3, s4] = calc.stages;
    const stage = (id: string) => prisma.stage.findUniqueOrThrow({ where: { id } });

    // 1. Миграция переносит факт в ручные записи, агрегат не меняется.
    await runBackfill(calc.id);
    const backfilled = await prisma.actualEntry.findMany({ where: { calculationId: calc.id } });
    assert.deepEqual(
      backfilled.map((e) => `${e.source}:${e.externalId}`).sort(),
      [`manual:stage:${s1.id}`, `manual:stage:${s3.id}`].sort(),
      'перенесены только этапы с фактом',
    );
    await recordManualStageEdit(prisma as never, {
      calculationId: calc.id,
      stageId: s1.id,
      endDate: day('2026-03-06'),
    });
    let s1Now = await stage(s1.id);
    assert.equal(s1Now.actualHours, 120, 'итог после миграции и пересчёта сохранён');
    assert.deepEqual(s1Now.actualStartDate, day('2026-03-02'));
    assert.deepEqual(s1Now.actualEndDate, day('2026-03-06'));

    // 2. Импорт worklog в журнал; повтор не удваивает факт.
    const rawImport = async (
      csv: string,
      manualHours: ManualHoursMode = 'auto',
      mode: SyncMode = 'incremental',
    ) => {
      const r = await importActualsCsv({
        calculationId: calc.id,
        csv,
        mode,
        manualHours,
        mappings: {},
        startedBy: 'ci',
        dryRun: false,
      });
      assert(r.ok);
      return r.sync;
    };
    const importCsv = (lines: string[], mode: SyncMode = 'incremental') =>
      rawImport(['id;этап;часы;дата;автор', ...lines].join('\n'), 'auto', mode);
    const rows = [
      'W1;Проектирование;4;2026-03-07;ivanov',
      'W2;Проектирование;6;2026-03-09;petrov',
      'W3;Проектирование;2;2026-03-10;ivanov',
    ];
    let res = await importCsv(rows);
    assert.deepEqual(res.counts, { created: 3, updated: 0, unchanged: 0, deleted: 0, skipped: 0 });
    assert.equal((await stage(s2.id)).actualHours, 12);
    res = await importCsv(rows);
    assert.deepEqual(res.counts, { created: 0, updated: 0, unchanged: 3, deleted: 0, skipped: 0 });
    assert.equal((await stage(s2.id)).actualHours, 12, 'повторный импорт не удваивает факт');
    assert.equal(
      await prisma.actualEntry.count({ where: { calculationId: calc.id, source: CSV_SOURCE } }),
      3,
    );

    // 3. Исправленная строка заменяет значение.
    const fixed = [rows[0], 'W2;Проектирование;7.5;2026-03-11;petrov', rows[2]];
    res = await importCsv(fixed);
    assert.equal(res.counts.updated, 1);
    let s2Now = await stage(s2.id);
    assert.equal(s2Now.actualHours, 13.5);
    assert.deepEqual(s2Now.actualStartDate, day('2026-03-07'));
    assert.equal(s2Now.actualEndDate, null, 'worklog не закрывает этап — окончание только вручную');

    // 4. Пропавшая строка: дельта не трогает, полная выгрузка помечает deletedAt.
    res = await importCsv([rows[0], 'W2;Проектирование;7.5;2026-03-11;petrov']);
    assert.equal(res.counts.deleted, 0);
    assert.equal((await stage(s2.id)).actualHours, 13.5);
    res = await importCsv([rows[0], 'W2;Проектирование;7.5;2026-03-11;petrov'], 'full');
    assert.equal(res.counts.deleted, 1);
    s2Now = await stage(s2.id);
    assert.equal(s2Now.actualHours, 11.5, 'удалённая запись выпала из агрегата');
    const w3 = await prisma.actualEntry.findFirstOrThrow({
      where: { calculationId: calc.id, source: CSV_SOURCE, externalId: 'id:W3' },
    });
    assert(w3.deletedAt, 'запись не стёрта, а помечена deletedAt');
    // Запись вернулась в выгрузку — восстанавливается.
    res = await importCsv(fixed, 'full');
    assert.equal(res.counts.updated, 1);
    assert.equal((await stage(s2.id)).actualHours, 13.5);

    // 5. Ручная правка — поправка к источнику; журнал прогонов ведётся.
    await recordManualStageEdit(prisma as never, {
      calculationId: calc.id,
      stageId: s2.id,
      hours: 15,
    });
    assert.equal((await stage(s2.id)).actualHours, 15);
    res = await importCsv(fixed, 'full');
    assert.equal((await stage(s2.id)).actualHours, 15, 'неизменный импорт не сбрасывает поправку');
    const runs = await prisma.actualSyncRun.count({ where: { calculationId: calc.id } });
    assert.equal(runs, 7);

    // 6. Ограничения БД.
    const base = { calculationId: calc.id, stageId: s2.id, hours: 1 };
    await assert.rejects(
      prisma.actualEntry.create({ data: { ...base, source: 'CSV', externalId: 'x' } }),
      /ActualEntry_source_check|constraint/i,
    );
    await assert.rejects(
      prisma.actualEntry.create({ data: { ...base, source: 'csv', externalId: 'y', hours: -1 } }),
      /ActualEntry_hours_check|constraint/i,
    );
    await assert.rejects(
      prisma.actualEntry.create({ data: { ...base, source: 'csv', externalId: 'id:W1' } }),
      /Unique constraint|P2002/i,
    );
    s1Now = await stage(s1.id);
    assert.equal(s1Now.actualHours, 120, 'импорт в другой этап не трогает перенесённый факт');

    // 7. Перенесённый факт + дельта CSV по тому же этапу складываются, ручные
    // даты и базовая запись сохраняются (и при полной выгрузке тоже).
    await importCsv(['W10;Обследование;8;2026-03-03;ivanov']);
    s1Now = await stage(s1.id);
    assert.equal(s1Now.actualHours, 128, 'перенесённые 120 ч + worklog 8 ч');
    assert.deepEqual(s1Now.actualStartDate, day('2026-03-02'));
    assert.deepEqual(s1Now.actualEndDate, day('2026-03-06'));
    await importCsv([...fixed, 'W10;Обследование;9;2026-03-03;ivanov'], 'full');
    s1Now = await stage(s1.id);
    assert.equal(s1Now.actualHours, 129);
    assert.deepEqual(s1Now.actualEndDate, day('2026-03-06'));
    const legacy = await prisma.actualEntry.findFirstOrThrow({
      where: { calculationId: calc.id, externalId: `stage:${s1.id}` },
    });
    assert.equal(legacy.deletedAt, null, 'базовая ручная запись не удаляется синхронизацией');

    // 8. Параллельные импорты и правки сериализуются блокировкой расчёта.
    await Promise.all([
      importCsv([...fixed, 'W10;Обследование;9;2026-03-03;ivanov', 'W11;Обследование;1;;']),
      importCsv([...fixed, 'W10;Обследование;9;2026-03-03;ivanov', 'W11;Обследование;1;;']),
      prisma.$transaction((tx) =>
        recordManualStageEdit(tx, { calculationId: calc.id, stageId: s1.id, hours: 20 }),
      ),
    ]);
    assert.equal(
      await prisma.actualEntry.count({ where: { calculationId: calc.id, externalId: 'id:W11' } }),
      1,
    );

    // 9. Строки-итоги старого формата заменяют ручные/перенесённые часы этапа,
    // worklog добавляется к ним; явный режим главнее, режим пишется в прогон.
    await rawImport('Анализ;40');
    assert.equal((await stage(s3.id)).actualHours, 40, 'перенесённые 40 + тот же итог 40 = 40');
    await rawImport('Анализ;45');
    assert.equal((await stage(s3.id)).actualHours, 45, 'накопительный итог заменяет, а не 85');
    await prisma.$transaction((tx) =>
      recordManualStageEdit(tx, { calculationId: calc.id, stageId: s4.id, hours: 40 }),
    );
    assert.equal((await stage(s4.id)).actualHours, 40);
    await rawImport(
      'id;этап;часы;дата\nT1;Тестирование;3;2026-03-02\nT2;Тестирование;4;2026-03-03',
      'replace',
    );
    assert.equal((await stage(s4.id)).actualHours, 7, '«заменить ручные часы» — сумма worklog');
    const lastRun = await prisma.actualSyncRun.findFirstOrThrow({
      where: { calculationId: calc.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(lastRun.manualHours, 'replace');
    await assert.rejects(
      prisma.actualSyncRun.update({ where: { id: lastRun.id }, data: { manualHours: 'merge' } }),
      /ActualSyncRun_manualHours_check|constraint/i,
    );

    console.log(
      'Actuals ledger integration passed: migration backfill preserves totals, idempotent re-import, corrections, full-sync soft delete and revive, end date manual only, manual base kept for worklog, stage totals replace manual hours, explicit replace mode, manual adjustment, advisory lock, DB constraints.',
    );
  } finally {
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
