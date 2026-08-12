import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { GOST34_LLM_ROLES } from '../roles';
import { parseVendorDocument } from '@/lib/gost34/parser/vendorDocParser';
import { normalizeRequirementItems } from '@/lib/gost34/parser/requirementSanitizer';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

export async function POST(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files?.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const rawExtractedRequirements: any[] = [];
    const parsedFiles: string[] = [];

    for (const file of files) {
      console.log('📄 Upload:', file.name, file.size, 'bytes');
      const buffer = Buffer.from(await file.arrayBuffer());

      const parsed = await parseVendorDocument(buffer, file.name);
      console.log('🔧 Detected ext:', file.name.split('.').pop()?.toLowerCase());

      const cleanedRequirements = parsed.extractedRequirements
        .map((req) => {
          const cleanTitle = req.title
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          const cleanDesc = req.description
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          return {
            ...req,
            originalText: req.description,
            title: cleanTitle,
            description: cleanDesc,
          };
        })
        .filter((r) => r.description.length > 5);

      rawExtractedRequirements.push(...cleanedRequirements);
      parsedFiles.push(file.name);
    }

    const normalizedRequirements = normalizeRequirementItems(rawExtractedRequirements);

    return NextResponse.json({
      parsedFiles,
      extractedRequirements: normalizedRequirements,
      rawCount: rawExtractedRequirements.length,
    });
  } catch (err: any) {
    console.error('❌ Error parsing vendor document:', err);
    return NextResponse.json({ error: err?.message || 'Parsing failed' }, { status: 500 });
  }
}
