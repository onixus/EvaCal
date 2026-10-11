/** Pricing modes and historical proposal reproducibility against the isolated CI database. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { createCalculationVersion } from '../lib/project';
import { loadCalculationForExport } from '../lib/export';
import { calculateCommercialSummary } from '../lib/commercial';
import { renderCalculationXlsx } from '../lib/xlsx';
import * as XLSX from 'xlsx';
import { loadCommercialState, loadCostItems } from '../lib/commercialContourData';

/** Строка спецификации для проверки (все обязательные поля заполнены). */
function specItem(id: string, over: Record<string, unknown>) {
  return {
    id,
    kind: 'hardware',
    disposition: 'supply',
    name: id,
    vendor: 'V',
    sku: id.toUpperCase(),
    quantity: '1',
    unit: 'шт',
    configuration: '',
    licensing: '',
    term: '',
    source: 'КП поставщика',
    rationale: 'CI',
    confirmed: true,
    unitPrice: '1',
    currency: 'RUB',
    ...over,
  };
}

async function main() {
  const template = await prisma.formTemplate.create({ data: { name: `pricing-${randomUUID()}` } });
  const project = await prisma.project.create({
    data: { name: 'Pricing integration', customer: 'CI' },
  });
  try {
    const source = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'Историческое КП',
        customer: 'CI',
        answers: '{}',
        status: 'approved',
        roleRates: '{"developer":101.1}',
        includeVat: false,
        stages: {
          create: {
            name: 'Работа',
            role: 'developer',
            hours: 1,
            order: 0,
            startDate: new Date(),
            endDate: new Date(),
          },
        },
      },
    });
    assert.equal(source.pricingMode, 'legacy_markup', 'migration/default keeps legacy rules');
    const original = (await loadCalculationForExport(source.id))!;
    const oldSummary = calculateCommercialSummary(
      original.stages,
      original.pmHours,
      original.risks,
      original,
    );
    assert.equal(oldSummary.grandTotal, 121.1);
    const version = await createCalculationVersion({ parentCalculationId: source.id });
    assert(version);
    assert.equal(version.pricingMode, source.pricingMode);
    assert.equal(version.roleRates, source.roleRates);
    assert.equal(version.includeVat, false);
    await prisma.calculation.update({
      where: { id: version.id },
      data: { pricingMode: 'target_margin' },
    });
    const updated = (await loadCalculationForExport(version.id))!;
    const summary = calculateCommercialSummary(
      updated.stages,
      updated.pmHours,
      updated.risks,
      updated,
    );
    assert.equal(summary.grandTotal, 126.38);
    assert.deepEqual(
      (await loadCalculationForExport(source.id))!,
      original,
      'source proposal remains unchanged',
    );
    const workbook = XLSX.read(renderCalculationXlsx(updated), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Смета КП'], { header: 1 });
    assert.equal(rows.find((row) => row[0] === 'ИТОГО К ОПЛАТЕ')?.[2], summary.grandTotal);
    await assert.rejects(
      prisma.calculation.update({ where: { id: version.id }, data: { marginPercent: 100 } }),
      /Calculation_targetMargin_check|constraint/i,
    );
    // #103 §4.2–4.3 / #101 §3: поставка, статьи затрат, курсы и порог маржи.
    assert.equal(
      (await loadCalculationForExport(source.id, undefined, { withSupply: true }))!.supply,
      null,
      'historical proposal has no supply section',
    );
    await prisma.specificationVersion.create({
      data: {
        calculationId: version.id,
        version: 1,
        status: 'confirmed',
        createdBy: 'ci',
        data: JSON.stringify({
          version: 1,
          status: 'confirmed',
          emptySupplyReason: '',
          exchangeRates: [
            { from: 'USD', to: 'RUB', rate: '90.5', date: '2026-10-01', source: 'ЦБ РФ' },
          ],
          items: [
            specItem('srv', {
              currency: 'USD',
              quantity: '2',
              unitPrice: '10',
              purchasePrice: '8',
            }),
            specItem('lic', {
              kind: 'license',
              licensing: 'бессрочная',
              unitPrice: '50.5',
              salePrice: '60',
              discountPercent: '10',
            }),
          ],
        }),
      },
    });
    await prisma.calculation.update({
      where: { id: version.id },
      data: { pinnedSpecificationVersion: 1, minMarginPercent: 30 },
    });
    await prisma.costItem.createMany({
      data: [
        {
          calculationId: version.id,
          kind: 'travel',
          description: 'Командировка',
          quantity: '1.5',
          unitCost: '1000.123456',
          currency: 'RUB',
          order: 0,
        },
        {
          calculationId: version.id,
          kind: 'license',
          description: 'Закупка лицензии',
          quantity: '1',
          unitCost: '40',
          currency: 'RUB',
          specItemRef: 'lic',
          order: 1,
        },
      ],
    });
    assert.deepEqual(
      (await loadCostItems(version.id)).map((c) => [c.quantity, c.unitCost]),
      [
        ['1.5', '1000.123456'],
        ['1', '40'],
      ],
      'exact decimals survive the database round trip',
    );
    const contour = (await loadCommercialState(version.id))!;
    const total = contour.summary.total;
    assert.equal(contour.summary.costItemsCost, 1500.19, 'standalone item enters the cost base');
    assert.equal(contour.summary.supply?.supplyPrice, 1864, '2×10 USD×90.5 + 60×(1−10%)');
    assert.equal(contour.summary.supply?.supplyCost, 1488, 'purchase 2×8×90.5 + linked item 40');
    assert.equal(contour.summary.subtotalExVat, 2001.61, '(101.1 + 1500.19) / (1 − 20%)');
    assert.equal(total.priceExVat, 3865.61);
    assert.equal(total.cost, 3089.29);
    assert.equal(total.profit, 776.32);
    assert.equal(total.incomplete, false);
    assert.equal(contour.gate.requiresApproval, true, 'margin 20.08% below 30% threshold');
    assert.equal(contour.gate.approved, false);
    const withSupply = (await loadCalculationForExport(version.id, undefined, {
      withSupply: true,
    }))!;
    const contourBook = XLSX.read(renderCalculationXlsx(withSupply), { type: 'buffer' });
    const contourRows = XLSX.utils.sheet_to_json<unknown[]>(contourBook.Sheets['Смета КП'], {
      header: 1,
    });
    assert.equal(contourRows.find((row) => row[0] === 'ИТОГО К ОПЛАТЕ')?.[2], total.grandTotal);
    assert(contourRows.some((row) => row[0] === 'Поставка без НДС' && row[2] === 1864));

    await prisma.discountApproval.create({
      data: {
        calculationId: version.id,
        requestedPercent: 0,
        resultingMargin: contour.gate.margin,
        minMarginPercent: 30,
        termsFingerprint: contour.fingerprint,
        status: 'approved',
        requestedBy: 'presale',
        decidedBy: 'architect',
        decidedAt: new Date(),
      },
    });
    assert.equal((await loadCommercialState(version.id))!.gate.approved, true);
    // Любое изменение условий снимает согласование: статья с неизвестной
    // стоимостью делает маржу неопределённой и меняет отпечаток.
    const unknownCost = await prisma.costItem.create({
      data: {
        calculationId: version.id,
        kind: 'other',
        description: 'Неизвестная статья',
        quantity: '1',
        currency: 'RUB',
        order: 5,
      },
    });
    const changed = (await loadCommercialState(version.id))!;
    assert.equal(changed.gate.state, 'unknown');
    assert.equal(changed.gate.approved, false, 'approval bound to the old terms fingerprint');
    await prisma.discountApproval.create({
      data: {
        calculationId: version.id,
        requestedPercent: 0,
        resultingMargin: null,
        minMarginPercent: 30,
        termsFingerprint: changed.fingerprint,
        status: 'approved',
        requestedBy: 'presale',
        decidedBy: 'architect',
        decidedAt: new Date(),
      },
    });
    assert.equal((await loadCommercialState(version.id))!.gate.approved, true);
    await prisma.costItem.update({
      where: { id: unknownCost.id },
      data: { description: 'Неизвестная статья (уточнено)' },
    });
    assert.equal(
      (await loadCommercialState(version.id))!.gate.approved,
      false,
      'unknown-margin approval does not survive a change of terms',
    );
    await prisma.costItem.delete({ where: { id: unknownCost.id } });

    const copy = await createCalculationVersion({ parentCalculationId: version.id });
    assert(copy);
    assert.equal(copy.minMarginPercent, 30, 'threshold copied');
    assert.equal(copy.pinnedSpecificationVersion, null, 'BOM revisions belong to the source');
    assert.deepEqual(
      (await loadCostItems(copy.id)).map((c) => [c.kind, c.unitCost, c.specItemRef]),
      [
        ['travel', '1000.123456', null],
        ['license', '40', 'lic'],
      ],
      'cost items copied to the next version',
    );
    assert.deepEqual(
      (await loadCalculationForExport(source.id))!,
      original,
      'historical proposal still reproduces after the contour was added',
    );
    await assert.rejects(
      prisma.exchangeRate.create({
        data: { from: 'USD', to: 'RUB', rate: '0', date: new Date(), source: 'x', createdBy: 'ci' },
      }),
      /ExchangeRate_rate_check|constraint/i,
    );
    await assert.rejects(
      prisma.costItem.create({
        data: {
          calculationId: version.id,
          kind: 'food',
          description: 'x',
          quantity: '1',
          currency: 'RUB',
        },
      }),
      /CostItem_kind_check|constraint/i,
    );
    await assert.rejects(
      prisma.discountApproval.create({
        data: {
          calculationId: version.id,
          requestedPercent: 5,
          minMarginPercent: 30,
          termsFingerprint: 'f'.repeat(64),
          status: 'approved',
          requestedBy: 'presale',
        },
      }),
      /DiscountApproval_decision_check|constraint/i,
    );
    console.log(
      'Commercial pricing integration passed: legacy default, preserved financial profile, independent new mode, immutable source proposal, XLSX totals, DB target-margin constraint, supply with stored rates, cost items without double counting, exact decimals, margin threshold gate, copied cost items, contour constraints.',
    );
  } finally {
    await prisma.exchangeRate.deleteMany({ where: { createdBy: 'ci' } });
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
