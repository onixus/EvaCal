import { prisma } from '@/lib/prisma';
import { INDUSTRY_PRESETS, IndustryPreset } from './industryPresets';

/**
 * Imports a predefined industry preset into the database as a FormTemplate.
 */
export async function importIndustryPreset(presetId: string, setAsActive: boolean = false) {
  const preset = INDUSTRY_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error(`Шаблон с ID "${presetId}" не найден в библиотеке пресетов.`);
  }

  return importPresetData(preset, setAsActive);
}

/**
 * Imports all predefined industry presets into the database if they don't already exist.
 */
export async function seedAllIndustryPresets() {
  const results = [];
  for (const preset of INDUSTRY_PRESETS) {
    const existing = await prisma.formTemplate.findFirst({
      where: { name: preset.name },
    });
    if (!existing) {
      const created = await importPresetData(preset, false);
      results.push(created);
    }
  }
  return results;
}

async function importPresetData(preset: IndustryPreset, setAsActive: boolean) {
  if (setAsActive) {
    // If activating, deactivate others or allow multiple active if desired
    await prisma.formTemplate.updateMany({
      data: { isActive: false },
    });
  }

  return prisma.formTemplate.create({
    data: {
      name: preset.name,
      description: preset.description,
      isActive: setAsActive,
      workDayHours: preset.workDayHours,
      includeWeekends: preset.includeWeekends,
      defaultMarginPercent: preset.defaultMarginPercent,
      defaultCurrency: 'RUB',
      defaultRoleRates: preset.defaultRoleRates ? JSON.stringify(preset.defaultRoleRates) : null,
      fields: {
        create: preset.fields.map((f) => ({
          label: f.label,
          key: f.key,
          type: f.type,
          options: f.options ? JSON.stringify(f.options) : null,
          required: f.required,
          order: f.order,
        })),
      },
      stageTemplates: {
        create: preset.stageTemplates.map((s) => ({
          name: s.name,
          role: s.role,
          baseHours: s.baseHours,
          hoursPerUnit: s.hoursPerUnit,
          driverFieldKey: s.driverFieldKey,
          requirements: s.requirements ?? null,
          order: s.order,
        })),
      },
      riskTemplates: {
        create: preset.riskTemplates.map((r) => ({
          description: r.description,
          hours: r.hours,
          order: r.order,
        })),
      },
    },
    include: {
      fields: { orderBy: { order: 'asc' } },
      stageTemplates: { orderBy: { order: 'asc' } },
      riskTemplates: { orderBy: { order: 'asc' } },
    },
  });
}
