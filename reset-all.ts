/**
 * Сброс паролей стендовых учётных записей.
 *
 * Запуск:
 *   npx tsx reset-all.ts admin                 — сбросить одного пользователя
 *   npx tsx reset-all.ts admin architect       — нескольких
 *   npx tsx reset-all.ts --all                 — всех
 *   docker compose run --rm migrate npx tsx reset-all.ts --all
 *
 * Каждому пользователю выдаётся свой случайный пароль (как при первом сиде) и
 * ставится mustChangePassword — до смены пароля API и страницы закрыты.
 * Пароли печатаются один раз в stdout и никуда не сохраняются: в Docker
 * возьмите их из вывода команды, локально — из терминала.
 */
import bcrypt from 'bcryptjs';
import { generatePassword } from './lib/password';
import { prisma } from './lib/prisma';

function usage(): never {
  console.error(
    'Использование: npx tsx reset-all.ts <логин> [<логин> ...] | --all\n' +
      'Без аргументов ничего не делает — сброс всех паролей требует явного --all.',
  );
  process.exit(2);
}

async function resetPasswords() {
  const args = process.argv.slice(2).filter(Boolean);
  if (args.length === 0) usage();

  const all = args.includes('--all');
  const usernames = args.filter((a) => a !== '--all');
  if (!all && usernames.length === 0) usage();

  const users = await prisma.user.findMany({
    where: all ? undefined : { username: { in: usernames } },
    select: { id: true, username: true, role: true },
    orderBy: { username: 'asc' },
  });

  const missing = usernames.filter((u) => !users.some((x) => x.username === u));
  if (missing.length > 0) {
    console.error(`Пользователи не найдены: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (users.length === 0) {
    console.error('В базе нет пользователей — выполните сид: npx tsx prisma/seed.ts');
    process.exit(1);
  }

  const issued: { username: string; role: string; password: string }[] = [];
  for (const user of users) {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true },
    });
    issued.push({ username: user.username, role: user.role, password });
  }

  const lines = [
    `EvaCal — пароли сброшены (${issued.length} шт.). Показываются один раз, сохраните их сейчас.`,
    'При первом входе потребуется сменить пароль в /account.',
    '',
    ...issued.map(
      (u) => `  роль: ${u.role.padEnd(10)} логин: ${u.username.padEnd(12)} пароль: ${u.password}`,
    ),
    '',
  ];
  console.log('\n' + '='.repeat(70));
  console.log(lines.join('\n'));
  console.log('='.repeat(70) + '\n');
}

resetPasswords()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
