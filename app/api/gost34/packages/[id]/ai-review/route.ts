import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { runGrokDocumentReview } from '@/lib/gost34/review/aiReviewEngine';
import { EndpointNotAllowedError } from '@/lib/gost34/llm/endpointGuard';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireStaff();
    if (session instanceof NextResponse) return session;

    const { id: packageId } = await params;
    const body = await req.json().catch(() => ({}));
    const { providerId, model } = body;

    const pkg = await prisma.gostPackage.findUnique({
      where: { id: packageId },
      include: { calculation: true },
    });

    if (!pkg) {
      return NextResponse.json({ error: 'Комплект не найден' }, { status: 404 });
    }

    // Собираем секции из сохраненного snapshot или метаданных
    let snapshot: any = null;
    if (pkg.snapshot) {
      try {
        snapshot = JSON.parse(pkg.snapshot);
      } catch {
        snapshot = null;
      }
    }

    const sections: Array<{ id: string; title: string; content: string }> = [];

    // Извлекаем требования и оверрайды разделов
    if (snapshot?.tzAuthor?.proposals) {
      for (const [nodeId, proposal] of Object.entries(
        snapshot.tzAuthor.proposals as Record<string, any>,
      )) {
        if (proposal?.paragraphs?.length) {
          sections.push({
            id: nodeId,
            title: proposal.nodeTitle || nodeId,
            content: proposal.paragraphs.join('\n\n'),
          });
        }
      }
    }

    if (snapshot?.requirements?.length) {
      sections.push({
        id: 'requirements-summary',
        title: 'Требования к системе',
        content: snapshot.requirements
          .slice(0, 30)
          .map((r: any) => `[${r.code || r.id}] ${r.title || ''}: ${r.text || r.description || ''}`)
          .join('\n'),
      });
    }

    if (sections.length === 0) {
      sections.push({
        id: 'general',
        title: 'Общие сведения о комплекте',
        content: `Комплект: ${pkg.name}, версия: ${pkg.version}, статус: ${pkg.status}`,
      });
    }

    const report = await runGrokDocumentReview({
      docType: Array.isArray(pkg.documentTypes) ? pkg.documentTypes.join(', ') : 'TZ',
      documentTitle: pkg.name,
      sections,
      providerId,
      model,
    });

    return NextResponse.json(report);
  } catch (err: any) {
    if (err instanceof EndpointNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleApiError(err, 'Ошибка при запуске ИИ-аудита документа');
  }
}
