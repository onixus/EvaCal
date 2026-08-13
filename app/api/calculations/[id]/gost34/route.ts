import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { prisma } from '@/lib/prisma';
import {
  loadCalculationForExport,
  safeFileName,
  contentDisposition,
  responseBody,
} from '@/lib/export';
import {
  buildBindingUpdate,
  generateGost34Document,
  GostDocumentType,
  GostExportType,
  Gost34RequirementItem,
  getZipEntries,
  resolveGost34Profile,
  resolveLayoutProfileId,
} from '@/lib/gost34';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';

/**
 * Fallback signatories used when the caller supplies none. Single source of
 * truth: the GET, POST and batch-ZIP paths must not drift apart.
 */
const DEFAULT_SIGNATURES = {
  developer: 'Иванов А.В.',
  checker: 'Петров С.Н.',
  techControl: 'Сидоров К.М.',
  normControl: 'Васильева Е.И.',
  approver: 'Михайлов Д.П.',
  customerApprover: 'Александров И.В.',
  invSubl: 'ИНВ-102938',
};

/**
 * Фиксирует в расчёте, каким нормативным профилем и какой версией генератора
 * выпущен комплект (раздел 5 плана модернизации). Сбой записи не должен
 * ломать уже сформированный документ — он только логируется.
 */
async function recordRelease(calculationId: string, standardProfileId?: string) {
  try {
    await prisma.calculation.update({
      where: { id: calculationId },
      data: buildBindingUpdate(standardProfileId),
    });
  } catch (err) {
    console.error('Failed to record GOST 34 release binding:', err);
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['export']);
  if (access instanceof NextResponse) return access;

  const calc = await loadCalculationForExport(params.id);
  if (!calc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const searchParams = req.nextUrl.searchParams;
  const docType = (searchParams.get('docType') || 'TZ') as GostDocumentType;
  const contractNumber = searchParams.get('contractNumber') || undefined;
  const city = searchParams.get('city') || undefined;
  const enrich = searchParams.get('enrich') !== 'false';

  const standardProfileId = searchParams.get('profile') || undefined;
  const layoutProfileId = resolveLayoutProfileId(searchParams.get('layout'));

  const { buffer, filename } = await generateGost34Document({
    calculation: calc,
    metadataOverride: {
      docType,
      contractNumber,
      city,
      enrichRequirements: enrich,
      standardProfileId,
      layoutProfileId,
      signatures: {
        ...DEFAULT_SIGNATURES,
        developer: searchParams.get('developer') || DEFAULT_SIGNATURES.developer,
        checker: searchParams.get('checker') || DEFAULT_SIGNATURES.checker,
        normControl: searchParams.get('normControl') || DEFAULT_SIGNATURES.normControl,
        approver: searchParams.get('approver') || DEFAULT_SIGNATURES.approver,
        customerApprover:
          searchParams.get('customerApprover') || DEFAULT_SIGNATURES.customerApprover,
        signDate: new Date().toLocaleDateString('ru-RU'),
      },
    },
  });

  await recordRelease(params.id, standardProfileId);

  await writeAudit({
    actorType: actorTypeFromAccess(access.kind),
    actorId: access.actorId,
    action: 'calculation.export.gost34',
    entityType: 'calculation',
    entityId: params.id,
    meta: { docType, method: 'GET' },
    ip: clientIp(req),
  });

  return new NextResponse(responseBody(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': contentDisposition(
        safeFileName(filename.replace(/\.docx$/, '')),
        'docx',
      ),
      'Content-Length': String(buffer.length),
    },
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const access = await requireCalcAccess(req, params.id, ['export']);
    if (access instanceof NextResponse) return access;

    const calc = await loadCalculationForExport(params.id);
    if (!calc) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await req.json();
    const {
      docType = 'TZ',
      isBatchZip = false,
      contractNumber,
      city,
      enrich = true,
      enrichmentOptions,
      applicabilityOverrides,
      developer = DEFAULT_SIGNATURES.developer,
      checker = DEFAULT_SIGNATURES.checker,
      normControl = DEFAULT_SIGNATURES.normControl,
      approver = DEFAULT_SIGNATURES.approver,
      customerApprover = DEFAULT_SIGNATURES.customerApprover,
      standardProfileId,
      layoutProfileId,
      rawRequirements,
      manualLinks,
    } = body;

    const layout = resolveLayoutProfileId(layoutProfileId);

    const commonSignatures = {
      ...DEFAULT_SIGNATURES,
      developer,
      checker,
      normControl,
      approver,
      customerApprover,
      signDate: new Date().toLocaleDateString('ru-RU'),
    };

    // If batch ZIP export is requested
    if (isBatchZip || (docType as GostExportType) === 'ZIP') {
      const zip = new JSZip();

      const zipEntries = getZipEntries(resolveGost34Profile(standardProfileId));

      // Generate all 5 GOST 34 documents in parallel
      const generatedDocs = await Promise.all(
        zipEntries.map(async (entry) => {
          const { buffer } = await generateGost34Document({
            calculation: calc,
            rawRequirements,
            manualTraceLinks: manualLinks,
            metadataOverride: {
              docType: entry.docType,
              contractNumber,
              city,
              enrichRequirements: Boolean(enrich),
              enrichmentOptions,
              applicabilityOverrides,
              standardProfileId,
              layoutProfileId: layout,
              signatures: commonSignatures,
            },
          });
          return { filename: entry.filename, buffer };
        }),
      );

      for (const doc of generatedDocs) {
        zip.file(doc.filename, doc.buffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipFilename = `GOST34_Full_Package_${safeFileName(calc.name)}.zip`;

      await recordRelease(params.id, standardProfileId);

      await writeAudit({
        actorType: actorTypeFromAccess(access.kind),
        actorId: access.actorId,
        action: 'calculation.export.gost34',
        entityType: 'calculation',
        entityId: params.id,
        meta: { method: 'POST', exportType: 'full-package-zip', docs: generatedDocs.length },
        ip: clientIp(req),
      });

      return new NextResponse(responseBody(zipBuffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': contentDisposition(zipFilename.replace(/\.zip$/, ''), 'zip'),
          'Content-Length': String(zipBuffer.length),
        },
      });
    }

    // Standard single file export
    const { buffer, filename } = await generateGost34Document({
      calculation: calc,
      rawRequirements,
      manualTraceLinks: manualLinks,
      metadataOverride: {
        docType,
        contractNumber,
        city,
        enrichRequirements: Boolean(enrich),
        enrichmentOptions,
        applicabilityOverrides,
        standardProfileId,
        layoutProfileId: layout,
        signatures: commonSignatures,
      },
    });

    await recordRelease(params.id, standardProfileId);

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'calculation.export.gost34',
      entityType: 'calculation',
      entityId: params.id,
      meta: { method: 'POST', docType },
      ip: clientIp(req),
    });

    return new NextResponse(responseBody(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': contentDisposition(
          safeFileName(filename.replace(/\.docx$/, '')),
          'docx',
        ),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err: unknown) {
    console.error('Error in GOST 34 POST export:', err);
    return handleApiError(err, 'Export error', 500);
  }
}
