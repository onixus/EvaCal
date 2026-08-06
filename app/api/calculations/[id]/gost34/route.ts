import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { loadCalculationForExport, safeFileName, contentDisposition } from '@/lib/export';
import { generateGost34Document, GostDocumentType, Gost34RequirementItem } from '@/lib/gost34';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const calc = await loadCalculationForExport(params.id);
  if (!calc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const searchParams = req.nextUrl.searchParams;
  const docType = (searchParams.get('docType') || 'TZ') as GostDocumentType;
  const contractNumber = searchParams.get('contractNumber') || undefined;
  const city = searchParams.get('city') || undefined;
  const enrich = searchParams.get('enrich') !== 'false';

  const developer = searchParams.get('developer') || 'Иванов А.В.';
  const checker = searchParams.get('checker') || 'Петров С.Н.';
  const normControl = searchParams.get('normControl') || 'Васильева Е.И.';
  const approver = searchParams.get('approver') || 'Михайлов Д.П.';
  const customerApprover = searchParams.get('customerApprover') || 'Александров И.В.';

  const { buffer, filename } = await generateGost34Document({
    calculation: calc,
    metadataOverride: {
      docType,
      contractNumber,
      city,
      enrichRequirements: enrich,
      signatures: {
        developer,
        checker,
        techControl: 'Сидоров К.М.',
        normControl,
        approver,
        customerApprover,
        invSubl: 'ИНВ-102938',
        signDate: new Date().toLocaleDateString('ru-RU'),
      },
    },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': contentDisposition(safeFileName(filename.replace(/\.docx$/, '')), 'docx'),
      'Content-Length': String(buffer.length),
    },
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
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
      developer = 'Иванов А.В.',
      checker = 'Петров С.Н.',
      normControl = 'Васильева Е.И.',
      approver = 'Михайлов Д.П.',
      customerApprover = 'Александров И.В.',
      rawRequirements,
    } = body;

    const commonSignatures = {
      developer,
      checker,
      techControl: 'Сидоров К.М.',
      normControl,
      approver,
      customerApprover,
      invSubl: 'ИНВ-102938',
      signDate: new Date().toLocaleDateString('ru-RU'),
    };

    // If batch ZIP export is requested
    if (isBatchZip || docType === 'ZIP') {
      const zip = new JSZip();

      const docTypesList: Array<{ type: GostDocumentType; prefix: string; name: string }> = [
        { type: 'TZ', prefix: '01_TZ', name: 'Техническое_задание_ГОСТ_34.602-89' },
        { type: 'PZ', prefix: '02_PZ', name: 'Пояснительная_записка_РД_50-34.698-90' },
        { type: 'AF', prefix: '03_AF', name: 'Описание_функций_РД_50-34.698-90' },
        { type: 'PMI', prefix: '04_PMI', name: 'Программа_и_методика_испытаний_РД_50-34.698-90' },
        { type: 'SPEC', prefix: '05_SPEC', name: 'Спецификация_оборудования_и_ПО_ГОСТ_34.201-89' },
      ];

      // Generate all 5 GOST 34 documents in parallel
      const generatedDocs = await Promise.all(
        docTypesList.map(async (docInfo) => {
          const { buffer } = await generateGost34Document({
            calculation: calc,
            rawRequirements,
            metadataOverride: {
              docType: docInfo.type,
              contractNumber,
              city,
              enrichRequirements: Boolean(enrich),
              enrichmentOptions,
              signatures: commonSignatures,
            },
          });
          return {
            filename: `${docInfo.prefix}_${docInfo.name}.docx`,
            buffer,
          };
        })
      );

      for (const doc of generatedDocs) {
        zip.file(doc.filename, doc.buffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipFilename = `GOST34_Full_Package_${safeFileName(calc.name)}.zip`;

      return new NextResponse(new Uint8Array(zipBuffer), {
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
      metadataOverride: {
        docType,
        contractNumber,
        city,
        enrichRequirements: Boolean(enrich),
        enrichmentOptions,
        signatures: commonSignatures,
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': contentDisposition(safeFileName(filename.replace(/\.docx$/, '')), 'docx'),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err: any) {
    console.error('Error in GOST 34 POST export:', err);
    return NextResponse.json({ error: err?.message || 'Export error' }, { status: 500 });
  }
}
