import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { loadPackageArtifact } from '@/lib/gost34/storage';
import { safeFileName, contentDisposition, responseBody } from '@/lib/export';
import { handleApiError } from '@/lib/apiHelpers';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const pkg = await prisma.gostPackage.findUnique({
      where: { id: params.id },
      include: {
        calculation: { select: { id: true, name: true } },
      },
    });

    if (!pkg) {
      return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });
    }

    // Access check: requires export or review scope
    const access = await requireCalcAccess(req, pkg.calculationId, ['read']);
    if (access instanceof NextResponse) return access;

    if (access.kind === 'share') {
      const allowed =
        access.share?.scopes.includes('export') || access.share?.scopes.includes('review');
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              'Share-токен не даёт права на скачивание архива (требуется scope export или review)',
          },
          { status: 403 },
        );
      }
    }

    if (!pkg.artifactPath) {
      return NextResponse.json(
        { error: 'Артефакт ZIP для данного пакета не был сохранён на диск' },
        { status: 404 },
      );
    }

    const loaded = await loadPackageArtifact(pkg.artifactPath);
    if (!loaded) {
      return NextResponse.json({ error: 'Файл артефакта не найден на сервере' }, { status: 404 });
    }

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'gost_package.artifact_download',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: { checksum: loaded.checksum, version: pkg.version },
      ip: clientIp(req),
    });

    const zipFilename = `GOST34_Package_v${pkg.version}_${safeFileName(pkg.calculation?.name || pkg.name)}.zip`;

    return new NextResponse(responseBody(loaded.buffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition(zipFilename.replace(/\.zip$/, ''), 'zip'),
        'Content-Length': String(loaded.buffer.length),
        ETag: `"${loaded.checksum}"`,
        'X-Checksum-SHA256': loaded.checksum,
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to download artifact', 500);
  }
}
