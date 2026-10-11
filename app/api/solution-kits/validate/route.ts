import { NextRequest, NextResponse } from 'next/server';
import { readJson, requireKitLibrary } from '@/lib/solutionKits/http';
import { checkKitContent, kitContentStats } from '@/lib/solutionKits/content';

/**
 * Проверка содержимого без сохранения: `{ content }` → форма (`shapeIssues`),
 * целостность (`issues`), сводка по разделам. `valid` — можно утверждать.
 */
export async function POST(req: NextRequest) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'Ожидается JSON-объект' }, { status: 400 });
  const checked = checkKitContent(body.content);
  return NextResponse.json({
    valid: !!checked.content && checked.issues.length === 0,
    shapeIssues: checked.shapeIssues,
    issues: checked.issues,
    stats: checked.content ? kitContentStats(checked.content) : null,
  });
}
