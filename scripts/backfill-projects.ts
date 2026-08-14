import { PrismaClient } from '@prisma/client';
import { backfillProjects } from '../lib/project';

const prisma = new PrismaClient();

async function main() {
  console.log('Запуск миграции расчетов в проекты...');
  const result = await backfillProjects();
  console.log(`Миграция завершена. Обработано расчетов: ${result.migratedCalculations}`);
}

main()
  .catch((e) => {
    console.error('Ошибка миграции проектов:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
