import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/access';
import { clientIp, writeAudit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: 'Введите логин и пароль' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    await writeAudit({
      actorType: 'anonymous',
      actorId: username || null,
      action: 'auth.login.failed',
      ip: clientIp(req),
    });
    return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
  }

  const token = createSessionToken(user);
  const res = NextResponse.json({
    ok: true,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_MAX_AGE_SECONDS));
  await writeAudit({
    actorType: 'user',
    actorId: user.id,
    action: 'auth.login',
    meta: { username: user.username, role: user.role },
    ip: clientIp(req),
  });
  return res;
}
