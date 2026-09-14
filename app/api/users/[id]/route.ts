import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole, revokeSessionsForUser } from '@/lib/auth';
import { APP_ROLES, isAppRole } from '@/lib/appRoles';
import { clientIp, writeAudit } from '@/lib/audit';

/**
 * Смена роли пользователя.
 *
 * Завести учётку и удалить её было можно, а переназначить роль — нет, поэтому
 * на стенде с накопленными данными смена ролевой модели требовала правки базы
 * руками. Роль — не косметика: ею определяется, чью подпись человек ставит под
 * комплектом, поэтому смена отзывает его сессии и пишется в аудит.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const role = body?.role;
  if (!isAppRole(role)) {
    return NextResponse.json(
      { error: `Роль должна быть одной из: ${APP_ROLES.map((r) => r.value).join(', ')}` },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (user.role === role) {
    return NextResponse.json({ id: user.id, username: user.username, role: user.role });
  }

  // Последний администратор не должен разжаловать сам себя: иначе управлять
  // пользователями станет некому и роль возвращается только через базу.
  if (user.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Нельзя снять роль с последнего администратора' },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data: { role } });

  // Роль зашита в подписанный токен сессии: без отзыва пользователь доработал
  // бы смену в прежних правах до истечения куки.
  revokeSessionsForUser(user.id);

  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'user.role.change',
    entityType: 'user',
    entityId: user.id,
    meta: { username: user.username, from: user.role, to: role },
    ip: clientIp(req),
  });

  return NextResponse.json({ id: updated.id, username: updated.username, role: updated.role });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (user.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Нельзя удалить последнего администратора' },
        { status: 409 },
      );
    }
  }

  await prisma.user.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
