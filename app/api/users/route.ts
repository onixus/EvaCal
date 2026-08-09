import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { generatePassword } from '@/lib/password';

const ALLOWED_ROLES = ['architect', 'admin'];

// User provisioning is admin-only.
export async function GET() {
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      role: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const username = String(body.username ?? '').trim();
  const role = body.role;

  if (!username) return NextResponse.json({ error: 'Укажите логин' }, { status: 400 });
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Роль должна быть architect или admin' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return NextResponse.json({ error: 'Такой логин уже существует' }, { status: 409 });

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, role, passwordHash, mustChangePassword: true },
  });

  // Plaintext password is returned exactly once — the client must show it now, it can't be recovered later.
  return NextResponse.json(
    { id: user.id, username: user.username, role: user.role, password },
    { status: 201 },
  );
}
