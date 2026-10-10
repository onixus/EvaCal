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
    console.log(
      'Commercial pricing integration passed: legacy default, preserved financial profile, independent new mode, immutable source proposal, XLSX totals, DB target-margin constraint.',
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
