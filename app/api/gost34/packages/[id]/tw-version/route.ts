import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { loadStoredFile, storeTechWriterVersion } from '@/lib/gost34/storage';
import { contentDisposition, responseBody, safeFileName } from '@/lib/export';
import { recordInternalChangeSafe } from '@/lib/changelog';
import { handleApiError } from '@/lib/apiHelpers';

/** DOCX и ничего больше: комплект собирается из Word-документов. */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Загрузка правленой версии тех.писателя. Она помечается приоритетной: выпуск
 * берёт её вместо сгенерированной, а факт замены попадает в лист внутренних
 * изменений — иначе подмена документа осталась бы незадокументированной.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id: params.id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
    if (access instanceof NextResponse) return access;

    if (pkg.status === 'approved') {
      return NextResponse.json(
        { error: 'Утверждённый комплект неизменяем: версию загрузить нельзя' },
        { status: 409 },
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Файл пустой' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Файл больше 25 МБ' }, { status: 413 });
    }
    // Тип проверяем и по MIME, и по расширению: браузеры не всегда ставят
    // MIME для .docx, а полагаться только на имя — значит принять что угодно.
    const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx');
    if (!isDocx) {
      return NextResponse.json({ error: 'Ожидается файл .docx' }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storeTechWriterVersion(pkg.projectId || pkg.calculationId, pkg.id, buffer);

    const actor =
      access.kind === 'staff' ? (access.session?.username ?? 'reviewer') : access.actorId;

    const updated = await prisma.gostPackage.update({
      where: { id: pkg.id },
      data: {
        twVersionPath: stored.artifactPath,
        twVersionName: file.name,
        twVersionUploadedAt: new Date(),
        twVersionUploadedBy: actor,
        twVersionIsPriority: true,
      },
    });

    await recordInternalChangeSafe({
      calculationId: pkg.calculationId,
      author: actor,
      role: access.kind === 'staff' ? (access.session?.role ?? 'reviewer') : 'reviewer',
      docRef: `Комплект · v${pkg.version}`,
      text: `Загружена версия ${file.name} — назначена приоритетной для выпуска.`,
      source: 'upload',
      packageId: pkg.id,
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor,
      action: 'gost_package.tw_version_upload',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: { fileName: file.name, checksum: stored.checksum, sizeBytes: stored.sizeBytes },
      ip: clientIp(req),
    });

    return NextResponse.json({
      twVersion: {
        name: updated.twVersionName,
        uploadedAt: updated.twVersionUploadedAt?.toISOString() ?? null,
        uploadedBy: updated.twVersionUploadedBy,
        isPriority: updated.twVersionIsPriority,
        checksum: stored.checksum,
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to upload tech writer version', 500);
  }
}

/** Скачивание ранее загруженной версии тех.писателя. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id: params.id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['read']);
    if (access instanceof NextResponse) return access;

    if (!pkg.twVersionPath) {
      return NextResponse.json({ error: 'Версия тех.писателя не загружена' }, { status: 404 });
    }

    const loaded = await loadStoredFile(pkg.twVersionPath);
    if (!loaded) {
      return NextResponse.json({ error: 'Файл версии не найден на сервере' }, { status: 404 });
    }

    return new NextResponse(responseBody(loaded.buffer), {
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': contentDisposition(
          safeFileName((pkg.twVersionName || 'tech-writer').replace(/\.docx$/i, '')),
          'docx',
        ),
        'Content-Length': String(loaded.buffer.length),
        'X-Checksum-SHA256': loaded.checksum,
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to download tech writer version', 500);
  }
}
