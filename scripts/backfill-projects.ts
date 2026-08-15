import 'dotenv/config';
import { backfillProjects } from '../lib/project';
import { prisma } from '../lib/prisma';

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
