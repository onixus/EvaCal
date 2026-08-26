/**
 * Локальные учётки для ручной проверки ролевых экранов.
 * Только для разработки: пароль одинаковый и известный.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

async function main() {
  const password = process.env.DEV_PASSWORD || 'devpass123';
  const hash = await bcrypt.hash(password, 10);

  for (const [username, role] of [
    ['presale', 'presale'],
    ['architect', 'architect'],
    ['reviewer', 'reviewer'],
    ['admin', 'admin'],
  ]) {
    await prisma.user.upsert({
      where: { username },
      create: { username, role, passwordHash: hash, mustChangePassword: false },
      update: { role, passwordHash: hash, mustChangePassword: false },
    });
    console.log(`${role.padEnd(10)} ${username.padEnd(10)} ${password}`);
  }
}

main().finally(() => prisma.$disconnect());
