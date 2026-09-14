import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import {
  createSessionToken,
  getSession,
  revokeSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/access';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Требуется вход в систему' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return NextResponse.json(
      { error: 'Укажите текущий пароль и новый пароль (не менее 8 символов)' },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: 'Текущий пароль указан неверно' }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  // Старый токен несёт mustChangePassword — отзываем его и выдаём новый без флага,
  // иначе гейты продолжали бы отвечать 403 до перелогина.
  revokeSession(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE_NAME,
    createSessionToken(updated),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS, req),
  );
  return res;
}
