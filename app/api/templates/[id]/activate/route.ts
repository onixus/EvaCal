import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';

// Включает/выключает шаблон для пресейла. Активных шаблонов может быть
// несколько — пресейл сам выбирает продукт/отрасль при заведении расчёта.
// Раньше активация гасила все остальные шаблоны, и пресейлу всегда
// доставался единственный «дефолтный».
//
// Тело: `{ active?: boolean }`, по умолчанию `true`.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const active = body?.active !== false;

  // Отдельная проверка вместо catch на update: иначе любая ошибка БД
  // маскировалась бы под 404.
  const exists = await prisma.formTemplate.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: 'template not found' }, { status: 404 });

  const updated = await prisma.formTemplate.update({
    where: { id: params.id },
    data: { isActive: active },
  });

  return NextResponse.json({ ok: true, isActive: updated.isActive });
}
