import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { generatePassword } from '@/lib/password';
import { pageArgs, paginationHeaders, parseLimit, parsePage } from '@/lib/pagination';

const ALLOWED_ROLES = ['architect', 'admin'];

// User provisioning is admin-only.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get('limit'));
  const page = parsePage(searchParams.get('page') ?? undefined);

  const [total, users] = await Promise.all([
    prisma.user.count(),
    prisma.user.findMany({
      ...pageArgs(page, limit),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        username: true,
        role: true,
        mustChangePassword: true,
        createdAt: true,
      },
    }),
  ]);
  return NextResponse.json(users, { headers: paginationHeaders(total, page, limit) });
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
