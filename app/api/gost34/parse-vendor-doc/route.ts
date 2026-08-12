import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { GOST34_LLM_ROLES } from '../roles';
import { parseVendorDocument } from '@/lib/gost34/parser/vendorDocParser';
import { normalizeRequirementItems } from '@/lib/gost34/parser/requirementSanitizer';

/**
 * Ceiling for one upload request. App Router route handlers have no built-in
 * body limit, so the effective gate is `client_max_body_size` in nginx/nginx.conf —
 * this check only turns an oversized request into a clear 413 in local runs and
 * behind proxies configured more generously. Keep both numbers in step.
 */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files?.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Upload exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` },
        { status: 413 }
      );
    }

    const rawExtractedRequirements: any[] = [];
    const parsedFiles: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      const parsed = await parseVendorDocument(buffer, file.name);

      // Clean unprintable binary control characters while preserving full Cyrillic text, «», №, —, tabs to spaces
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
            // Recorded before any cleaning: everything downstream carries it forward.
            originalText: req.description,
            title: cleanTitle,
            description: cleanDesc,
          };
        })
        .filter((r) => r.description.length > 5);

      rawExtractedRequirements.push(...cleanedRequirements);
      parsedFiles.push(file.name);
    }

    // Run structural normalization & auto-categorization
    const normalizedRequirements = normalizeRequirementItems(rawExtractedRequirements);

    return NextResponse.json({
      parsedFiles,
      extractedRequirements: normalizedRequirements,
      rawCount: rawExtractedRequirements.length,
    });
  } catch (err: any) {
    console.error('Error parsing vendor document:', err);
    return NextResponse.json({ error: err?.message || 'Parsing failed' }, { status: 500 });
  }
}
