import { NextRequest, NextResponse } from 'next/server';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { contentDisposition, responseBody, safeFileName } from '@/lib/exportResponse';
import { loadStoredFile } from '@/lib/gost34/storage';
import { loadPackageForRead, loadPackageForWrite } from '@/lib/acceptance/http';
import { validateEvidenceFile } from '@/lib/acceptance/rules';
import { findEvidence, loadCheck, uploadEvidence } from '@/lib/acceptance/store';

type Props = { params: Promise<{ id: string; checkId: string }> };

/**
 * Загрузка вложения к будущему результату проверки (протокол, скриншот,
 * журнал). Файл сохраняется в хранилище комплектов под ключом проверки и
 * возвращается ссылкой; к результату он привязывается при записи результата.
 */
export async function POST(req: NextRequest, props: Props) {
  try {
    const { id, checkId } = await props.params;
    const loaded = await loadPackageForWrite(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const { pkg, access, actor } = loaded;

    const check = await loadCheck(pkg.id, checkId);
    if (!check) return NextResponse.json({ error: 'Проверка не найдена' }, { status: 404 });

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    }
    const valid = validateEvidenceFile({ name: file.name, size: file.size, type: file.type });
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: valid.status });

    const ref = await uploadEvidence({
      packageId: pkg.id,
      checkId: check.id,
      fileName: file.name,
      ext: valid.value.ext,
      mime: valid.value.mime,
      buffer: Buffer.from(await file.arrayBuffer()),
      uploadedBy: actor.name,
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.id,
      action: 'acceptance_evidence.upload',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: { checkId: check.id, key: ref.key, size: ref.size, checksum: ref.checksum },
      ip: clientIp(req),
    });

    return NextResponse.json({ evidence: ref }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to upload acceptance evidence', 500);
  }
}

/**
 * Скачивание вложения. Отдаётся только файл, на который ссылается записанный
 * результат этой проверки: незакреплённые загрузки и чужие ключи не видны.
 */
export async function GET(req: NextRequest, props: Props) {
  try {
    const { id, checkId } = await props.params;
    const loaded = await loadPackageForRead(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const check = await loadCheck(loaded.pkg.id, checkId);
    if (!check) return NextResponse.json({ error: 'Проверка не найдена' }, { status: 404 });

    const key = req.nextUrl.searchParams.get('key') ?? '';
    const ref = key ? await findEvidence(check.id, key) : null;
    if (!ref) return NextResponse.json({ error: 'Вложение не найдено' }, { status: 404 });
    const file = await loadStoredFile(ref.key);
    if (!file) {
      return NextResponse.json({ error: 'Файл вложения не найден на сервере' }, { status: 404 });
    }
    return new NextResponse(responseBody(file.buffer), {
      headers: {
        'Content-Type': ref.mime || 'application/octet-stream',
        'Content-Disposition': contentDisposition(
          safeFileName((ref.name || 'evidence').replace(/\.[^.]+$/, '')),
          ref.key.split('.').pop() || 'bin',
        ),
        'Content-Length': String(file.buffer.length),
        'X-Content-Type-Options': 'nosniff',
        'X-Checksum-SHA256': file.checksum,
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to download acceptance evidence', 500);
  }
}
