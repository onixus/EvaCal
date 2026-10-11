/** Сравнение вариантов КП и прогноз прибыли (#103 4.4–4.5) на живой PostgreSQL:
 * CHECK оценки остатка, факт из журнала × ставки версии, «неизвестно» ≠ 0,
 * воспроизводимость исходного КП при новых ставках, неполная спецификация.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { createCalculationVersion } from '../lib/project';
import { rebuildStages } from '../lib/calc';
import { recordManualStageEdit } from '../lib/actualsLedgerData';
import { loadActualsSummary } from '../lib/actualsData';
import { loadOfferComparison } from '../lib/offerCompareData';
import type { ProfitForecast } from '../lib/actuals';
import { isOfferError, type OfferResult, type OfferVariant } from '../lib/offerCompare';

/** Прогноз из сводки факта; ошибка прогноза — провал проверки. */
async function forecastOf(calculationId: string): Promise<ProfitForecast> {
  const f = (await loadActualsSummary(calculationId))?.forecast;
  assert(f && !('error' in f), `прогноз рассчитан: ${f && 'error' in f ? f.error : 'нет'}`);
  return f;
}

function computed(v: OfferResult): OfferVariant {
  assert(!isOfferError(v), isOfferError(v) ? v.error : '');
  return v;
}

const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  const template = await prisma.formTemplate.create({ data: { name: `forecast-${randomUUID()}` } });
  const project = await prisma.project.create({
    data: { name: 'Profit forecast integration', customer: 'CI' },
  });
  try {
    const v1 = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'Исходное КП',
        customer: 'CI',
        answers: '{}',
        status: 'approved',
        pricingMode: 'markup',
        roleRates: '{"developer":1000,"analyst":2000,"pm":1500}',
        overheadPercent: 10,
        marginPercent: 20,
        includeVat: false,
        pmHours: 0,
        stages: {
          create: [
            {
              name: 'Анализ',
              role: 'analyst',
              hours: 10,
              order: 0,
              status: 'done',
              startDate: day('2026-11-02'),
              endDate: day('2026-11-06'),
            },
            {
              name: 'Разработка',
              role: 'developer',
              hours: 50,
              order: 1,
              status: 'in_progress',
              startDate: day('2026-11-09'),
              endDate: day('2026-11-27'),
            },
          ],
        },
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    const [analysis, dev] = v1.stages;

    await assert.rejects(
      prisma.stage.update({ where: { id: dev.id }, data: { remainingHoursEstimate: -1 } }),
      /Stage_remainingHoursEstimate_check|constraint/i,
    );
    await assert.rejects(
      prisma.calculation.update({ where: { id: v1.id }, data: { remainingPmHoursEstimate: -0.5 } }),
      /Calculation_remainingPmHoursEstimate_check|constraint/i,
    );

    await prisma.project.update({
      where: { id: project.id },
      data: {
        dealStatus: 'won',
        wonCalculationId: v1.id,
        contractAmount: 100000,
        contractCurrency: 'RUB',
      },
    });
    // Факт — через журнал: Stage.actualHours пересчитывается из записей.
    await prisma.$transaction((tx) =>
      recordManualStageEdit(tx, { calculationId: v1.id, stageId: analysis.id, hours: 12 }),
    );
    await prisma.$transaction((tx) =>
      recordManualStageEdit(tx, { calculationId: v1.id, stageId: dev.id, hours: 30 }),
    );

    const before = await forecastOf(v1.id);
    assert.equal(before.partial, true, 'разработка без оценки остатка — прогноз неполный');
    assert.deepEqual(
      before.incomplete.map(({ name, state }) => ({ name, state })),
      [{ name: 'Разработка', state: 'missing_remaining' }],
    );
    assert.equal(before.profit, null, 'неизвестный остаток не превращается в 0');
    assert.equal(before.actualCost, 59400, '(12×2000 + 30×1000) × 1.1');

    await prisma.stage.update({
      where: { id: dev.id },
      data: {
        remainingHoursEstimate: 20,
        remainingActualBaseline: 30,
        remainingEstimatedBy: 'ci',
        remainingEstimatedAt: new Date(),
      },
    });
    const forecast = await forecastOf(v1.id);
    // Факт по журналу изменился после оценки — оценка устарела, прогноз неполный.
    await prisma.$transaction((tx) =>
      recordManualStageEdit(tx, { calculationId: v1.id, stageId: dev.id, hours: 35 }),
    );
    const stale = await forecastOf(v1.id);
    assert.equal(stale.partial, true);
    assert.deepEqual(
      stale.incomplete.map((i) => i.state),
      ['stale_estimate'],
    );
    assert.match(stale.incomplete[0].reason, /при факте 30 ч, сейчас 35 ч/);
    await prisma.$transaction((tx) =>
      recordManualStageEdit(tx, { calculationId: v1.id, stageId: dev.id, hours: 30 }),
    );
    await assert.rejects(
      prisma.stage.update({ where: { id: dev.id }, data: { remainingActualBaseline: -1 } }),
      /Stage_remainingActualBaseline_check|constraint/i,
    );
    assert.equal(forecast.partial, false);
    assert.equal(forecast.forecastCost, 81400);
    assert.equal(forecast.profit, 18600);
    assert.equal(forecast.lines[0].remainingSource, 'done', 'у завершённого этапа остаток 0');

    await assert.rejects(
      loadOfferComparison(project.id, [v1.id, `missing-${randomUUID()}`]),
      /не найдена/,
    );

    // Новая версия с другими ставками не переписывает исходное КП и прогноз.
    const v2 = await createCalculationVersion({ parentCalculationId: v1.id });
    assert(v2);
    const v2Stage = await prisma.stage.findFirstOrThrow({
      where: { calculationId: v2.id, name: 'Разработка' },
    });
    assert.equal(v2Stage.remainingHoursEstimate, null, 'оценка остатка не копируется в версию');
    // Перестройка плана на месте (#118) не затирает подтверждённую оценку остатка.
    await prisma.stage.update({
      where: { id: v2Stage.id },
      data: {
        remainingHoursEstimate: 7,
        remainingEstimatedBy: 'ci',
        remainingEstimatedAt: new Date(),
      },
    });
    await rebuildStages(
      v2.id,
      [
        { name: 'Анализ', role: 'analyst', hours: 10 },
        { name: 'Разработка', role: 'developer', hours: 50, sourceStageId: v2Stage.id },
      ],
      day('2026-11-02'),
    );
    const rebuilt = await prisma.stage.findUniqueOrThrow({ where: { id: v2Stage.id } });
    assert.equal(rebuilt.remainingHoursEstimate, 7, 'rebuildStages сохраняет оценку остатка');
    assert.equal(rebuilt.remainingEstimatedBy, 'ci');
    await prisma.calculation.update({
      where: { id: v2.id },
      data: { status: 'draft', roleRates: '{"developer":3000,"analyst":3000,"pm":3000}' },
    });
    await prisma.specificationVersion.create({
      data: {
        calculationId: v1.id,
        version: 1,
        status: 'confirmed',
        createdBy: 'ci',
        data: JSON.stringify({
          version: 1,
          status: 'confirmed',
          emptySupplyReason: '',
          items: [
            {
              id: 'i1',
              kind: 'hardware',
              disposition: 'supply',
              name: 'Сервер',
              vendor: 'V',
              sku: 'S1',
              quantity: '2',
              unit: 'шт',
              configuration: '',
              licensing: '',
              term: '',
              source: 'КП поставщика',
              rationale: '',
              confirmed: true,
              unitPrice: '100.5',
              currency: 'RUB',
            },
            {
              id: 'i2',
              kind: 'license',
              disposition: 'supply',
              name: 'Лицензия',
              vendor: 'V',
              sku: 'L1',
              quantity: '1',
              unit: 'шт',
              configuration: '',
              licensing: '',
              term: '',
              source: 'запрос',
              rationale: '',
              confirmed: true,
              unitPrice: null,
              currency: 'RUB',
            },
          ],
        }),
      },
    });

    const compared = await loadOfferComparison(project.id, [v1.id, v2.id]);
    const [first, second] = compared.variants.map(computed);
    assert.equal(first.money.totalCost, 77000, '(10×2000 + 50×1000) × 1.1 по ставкам v1');
    assert.equal(second.money.totalCost, 198000, '60×3000 × 1.1 по ставкам v2');
    assert.equal(second.delta?.totalCost, 121000);
    assert.equal(first.term?.calendarDays, 26);
    assert.equal(first.specification.state, 'confirmed');
    assert.equal(first.specification.incomplete, true, 'неизвестная цена — не 0');
    assert.equal(first.specification.totals[0].total, '201');
    assert.equal(second.specification.state, 'none');

    const after = await forecastOf(v1.id);
    assert.deepEqual(after, forecast, 'новые ставки в v2 не меняют прогноз v1');

    console.log(
      'Profit forecast integration passed: CHECK constraints, ledger actuals × version rates, unknown ≠ 0, done stages, offer comparison with stored rates, incomplete specification, immutable history.',
    );
  } finally {
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
