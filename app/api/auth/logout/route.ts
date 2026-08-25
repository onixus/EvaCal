import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, revokeSession } from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/access';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    revokeSession(token);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(0), maxAge: 0 });
  return res;
}
