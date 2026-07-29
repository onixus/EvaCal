import { PrismaClient } from "@prisma/client";
import { primaryStagesFromTemplate, rebuildStages } from "../lib/calc";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.formTemplate.findFirst();
  if (existing) {
    console.log("Данные уже существуют, пропускаю сид.");
    return;
  }

  const template = await prisma.formTemplate.create({
    data: {
      name: "Внедрение CRM-системы",
      description: "Базовый опросник пресейла для проектов внедрения",
      isActive: true,
      fields: {
        create: [
          { label: "Количество пользователей", key: "users_count", type: "number", required: true, order: 0 },
          { label: "Количество интеграций", key: "integrations_count", type: "number", required: true, order: 1 },
          { label: "Количество экранов/форм", key: "screens_count", type: "number", required: true, order: 2 },
          {
            label: "Сложность проекта",
            key: "complexity",
            type: "select",
            options: JSON.stringify(["Простой", "Средний", "Сложный"]),
            required: true,
            order: 3,
          },
          { label: "Комментарий", key: "comment", type: "textarea", required: false, order: 4 },
        ],
      },
      stageTemplates: {
        create: [
          { name: "Сбор требований", role: "analyst", baseHours: 16, hoursPerUnit: 1.5, driverFieldKey: "screens_count", order: 0 },
          { name: "Консультация по архитектуре", role: "consultant", baseHours: 8, hoursPerUnit: 0, driverFieldKey: null, order: 1 },
          { name: "Разработка интеграций", role: "developer", baseHours: 8, hoursPerUnit: 12, driverFieldKey: "integrations_count", order: 2 },
          { name: "Настройка инфраструктуры", role: "engineer", baseHours: 12, hoursPerUnit: 0.2, driverFieldKey: "users_count", order: 3 },
          { name: "Тестирование и приёмка", role: "engineer", baseHours: 16, hoursPerUnit: 1, driverFieldKey: "screens_count", order: 4 },
        ],
      },
    },
    include: { stageTemplates: true },
  });

  const answers = {
    users_count: 50,
    integrations_count: 3,
    screens_count: 12,
    complexity: "Средний",
    comment: "Демонстрационный расчёт, созданный при первом запуске.",
  };

  const calculation = await prisma.calculation.create({
    data: {
      name: "CRM для «Ромашка Логистик»",
      customer: "ООО «Ромашка Логистик»",
      templateId: template.id,
      answers: JSON.stringify(answers),
      status: "approved",
      createdBy: "presale",
    },
  });

  const primary = primaryStagesFromTemplate(template.stageTemplates, answers);
  await rebuildStages(calculation.id, primary, calculation.startDate);

  console.log("Сид выполнен: создан шаблон и демонстрационный расчёт.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
