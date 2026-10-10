import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { importFormData } from '@/lib/catalog/import-body';
import { analyzeBom, parseBomProfile } from '@/lib/specification/bom-import';
import { SpecificationError } from '@/lib/specification/validation';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/**
 * BOM preview: parses an uploaded XLSX/CSV and returns per-row items and errors.
 * Nothing is stored; the panel saves selected valid rows as a new draft revision
 * through the regular specification POST (version check, validation, audit).
 */
export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['write']);
    if (access instanceof NextResponse) return access;
    const form = await importFormData(req);
    const file = form.get('file');
    if (!(file instanceof File)) throw new SpecificationError('Требуется файл BOM');
    let profile: unknown;
    try {
      profile = JSON.parse(String(form.get('profile') ?? '{}'));
    } catch {
      throw new SpecificationError('Некорректный профиль импорта');
    }
    const preview = analyzeBom(
      new Uint8Array(await file.arrayBuffer()),
      file.name.slice(0, 200),
      parseBomProfile(profile),
    );
    return NextResponse.json(preview);
  } catch (error) {
    const status =
      error instanceof SpecificationError
        ? error.statusCode
        : error instanceof SyntaxError || error instanceof TypeError
          ? 400
          : 500;
    return NextResponse.json(
      { error: status === 500 ? 'Ошибка импорта BOM' : (error as Error).message },
      { status },
    );
  }
}
