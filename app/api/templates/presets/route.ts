import { NextResponse } from 'next/server';
import { INDUSTRY_PRESETS } from '@/lib/presets/industryPresets';
import { importIndustryPreset, seedAllIndustryPresets } from '@/lib/presets/importer';
import { getStaffSession } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    presets: INDUSTRY_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      fieldsCount: p.fields.length,
      stagesCount: p.stageTemplates.length,
      risksCount: p.riskTemplates.length,
      defaultMarginPercent: p.defaultMarginPercent,
      defaultRoleRates: p.defaultRoleRates,
    })),
  });
}

export async function POST(req: Request) {
  const staff = await getStaffSession();
  if (!staff) {
    return NextResponse.json({ error: 'Требуются права администратора' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { presetId, importAll, setAsActive } = body;

    if (importAll) {
      const imported = await seedAllIndustryPresets();
      return NextResponse.json({ success: true, count: imported.length, imported });
    }

    if (!presetId) {
      return NextResponse.json({ error: 'Не указан presetId' }, { status: 400 });
    }

    const template = await importIndustryPreset(presetId, !!setAsActive);
    return NextResponse.json({ success: true, template });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Ошибка импорта шаблона';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
