import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma';

async function resetAll() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('resetAll is strictly forbidden in production');
  }
  const newPassword = process.env.NEW_PASSWORD?.trim() || 'tFczY9wyWabx'; 
  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  await prisma.user.updateMany({
    data: { 
      passwordHash,
      mustChangePassword: true
    },
  });

  const users = await prisma.user.findMany({ select: { username: true, role: true } });
  const lines = [
    'EvaCal — учётные записи локального стенда (пароли сброшены через reset-all.ts)',
    'При первом входе система может запросить смену пароля (mustChangePassword: true).',
    '',
    ...users.map(
      (u) => `  роль: ${u.role.padEnd(10)} логин: ${u.username.padEnd(12)} пароль: ${newPassword}`,
    ),
    '',
  ];

  console.log('\n' + '='.repeat(70));
  console.log(lines.join('\n'));
  console.log('='.repeat(70));

  const rootCredentials = path.resolve(__dirname, 'credentials.local.txt');
  const volumeCredentials = path.resolve(__dirname, 'prisma', 'credentials.local.txt');

  try {
    fs.writeFileSync(rootCredentials, lines.join('\n'), 'utf-8');
  } catch {}

  try {
    fs.writeFileSync(volumeCredentials, lines.join('\n'), 'utf-8');
  } catch {}

  console.log(`✅ Пароли для всех пользователей (${users.length} шт.) успешно сброшены на: ${newPassword}`);
  console.log(`Файлы учётных данных обновлены:`);
  console.log(`  - ${rootCredentials}`);
  console.log(`  - ${volumeCredentials}\n`);

  await prisma.$disconnect();
}

resetAll().catch((e) => {
  console.error('Error', e);
  process.exit(1);
});

