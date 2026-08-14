import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  primaryStagesFromTemplate,
  rebuildStages,
  pmHoursFor,
  scheduleConfigFromTemplate,
} from '../lib/calc';
import { generatePassword } from '../lib/password';

const prisma = new PrismaClient();

async function seedDefaultUsers() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log('Учётные записи уже созданы, пропускаю генерацию паролей.');
    return;
  }

  const accounts = [
    { username: 'architect', role: 'architect' },
    { username: 'admin', role: 'admin' },
  ];

  const credentials: { username: string; role: string; password: string }[] = [];

  for (const account of accounts) {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        username: account.username,
        role: account.role,
        passwordHash,
        mustChangePassword: true,
      },
    });
    credentials.push({ ...account, password });
  }

  const lines = [
    'EvaCal — учётные записи по умолчанию (созданы при первом запуске)',
    'Эти пароли показываются только один раз. Смените их после первого входа в /account.',
    '',
    ...credentials.map(
      (c) => `  роль: ${c.role.padEnd(10)} логин: ${c.username.padEnd(12)} пароль: ${c.password}`,
    ),
    '',
  ];

  console.log('\n' + '='.repeat(70));
  console.log(lines.join('\n'));
  console.log('='.repeat(70) + '\n');

  const credentialsFile = path.resolve(__dirname, '..', 'credentials.local.txt');
  fs.writeFileSync(credentialsFile, lines.join('\n'), 'utf-8');
  console.log(
    `Пароли также сохранены в ${credentialsFile} (в .gitignore, удалите файл после смены паролей).\n`,
  );
}

async function main() {
  await seedDefaultUsers();

  const { seedAllIndustryPresets } = await import('../lib/presets/importer');
  const seededPresets = await seedAllIndustryPresets();
  if (seededPresets.length > 0) {
    console.log(`Импортировано отраслевых пресетов ИТ/ИБ: ${seededPresets.length} шт.`);
  }

  const existing = await prisma.formTemplate.findFirst();
  if (existing) {
    console.log('Демо-шаблон и расчёт уже существуют, пропускаю.');
    return;
  }

  const template = await prisma.formTemplate.create({
    data: {
      name: 'Внедрение CRM-системы',
      description: 'Базовый опросник пресейла для проектов внедрения',
      isActive: true,
      fields: {
        create: [
          {
            label: 'Количество пользователей',
            key: 'users_count',
            type: 'number',
            required: true,
            order: 0,
          },
          {
            label: 'Количество интеграций',
            key: 'integrations_count',
            type: 'number',
            required: true,
            order: 1,
          },
          {
            label: 'Количество экранов/форм',
            key: 'screens_count',
            type: 'number',
            required: true,
            order: 2,
          },
          {
            label: 'Сложность проекта',
            key: 'complexity',
            type: 'complexity',
            required: true,
            order: 3,
          },
          {
            label: 'Комментарий',
            key: 'comment',
            type: 'textarea',
            required: false,
            order: 4,
          },
        ],
      },
      stageTemplates: {
        create: [
          {
            name: 'Сбор требований',
            role: 'analyst',
            baseHours: 16,
            hoursPerUnit: 1.5,
            driverFieldKey: 'screens_count',
            order: 0,
          },
          {
            name: 'Консультация по архитектуре',
            role: 'consultant',
            baseHours: 8,
            hoursPerUnit: 0,
            driverFieldKey: null,
            order: 1,
          },
          {
            name: 'Разработка интеграций',
            role: 'developer',
            baseHours: 8,
            hoursPerUnit: 12,
            driverFieldKey: 'integrations_count',
            order: 2,
          },
          {
            name: 'Настройка инфраструктуры',
            role: 'engineer',
            baseHours: 12,
            hoursPerUnit: 0.2,
            driverFieldKey: 'users_count',
            order: 3,
          },
          {
            name: 'Тестирование и приёмка',
            role: 'engineer',
            baseHours: 16,
            hoursPerUnit: 1,
            driverFieldKey: 'screens_count',
            order: 4,
          },
        ],
      },
    },
    include: { stageTemplates: true, fields: true },
  });

  const answers = {
    users_count: 50,
    integrations_count: 3,
    screens_count: 12,
    complexity: 'Средний',
    comment: 'Демонстрационный расчёт, созданный при первом запуске.',
  };

  const primary = primaryStagesFromTemplate(template.stageTemplates, answers);
  primary[0].requirements =
    'Интеграция только с существующей учётной системой заказчика, без миграции исторических данных.';
  // Demonstrates the architect's Gantt controls: infra setup runs alongside integration
  // development, and testing gets a longer 5-day customer sign-off instead of the default 3.
  primary[3].parallel = true;
  primary[4].approvalDays = 5;
  const pmHours = pmHoursFor(template.fields, answers, primary);

  const calculation = await prisma.calculation.create({
    data: {
      name: 'CRM для «Ромашка Логистик»',
      customer: 'ООО «Ромашка Логистик»',
      templateId: template.id,
      answers: JSON.stringify(answers),
      status: 'approved',
      createdBy: 'presale',
      startDate: new Date(),
      pmHours,
      risks: {
        create: [
          {
            description:
              'Заказчик может задержать предоставление доступов к учётной системе для интеграции.',
            hours: 8,
            order: 0,
          },
        ],
      },
    },
  });

  await rebuildStages(
    calculation.id,
    primary,
    calculation.startDate,
    scheduleConfigFromTemplate(template),
  );

  console.log('Сид выполнен: создан базовый шаблон и демонстрационный расчёт.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
