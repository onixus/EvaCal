/**
 * Демо-портфель для разбора воронки, медианных отклонений и ресурсного плана.
 *
 * Данные считаются боевыми функциями (`primaryStagesFromTemplate`, `rebuildStages`,
 * `pmHoursFor`), поэтому Гант и часы совпадают с тем, что построит приложение.
 *
 * Отклонения задаются не шумом, а смещением по типу задачи и по архитектору —
 * иначе медианы по любой группировке сходятся к нулю и отчёт E3 нечего показывать.
 *
 * Запуск: npx tsx scripts/seed-portfolio.ts
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import {
  primaryStagesFromTemplate,
  risksFromTemplate,
  rebuildStages,
  pmHoursFor,
  scheduleConfigFromTemplate,
} from '../lib/calc';
import { COMPLEXITY_OPTIONS } from '../lib/pm';

const SEED_PREFIX = 'PRJ-SEED-';
const PASSWORD = process.env.DEV_PASSWORD || 'devpass123';
const PRESALE_COUNT = 10;
const ARCHITECT_COUNT = 5;
const PROJECT_COUNT = 90;

// Детерминированный PRNG: повторный запуск даёт тот же портфель, иначе
// метрики «плывут» между прогонами и их невозможно сравнивать.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260914);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => Math.floor(min + rnd() * (max - min + 1));

// ---------------------------------------------------------------------------
// Производственный календарь РФ: 40-часовая неделя и отпуска
// ---------------------------------------------------------------------------

/** 8ч × 5 дней — та самая 40-часовая неделя, от которой пляшет вся ёмкость. */
const WORK_DAY_HOURS = 8;
/** 28 календарных дней отпуска ≈ 20 рабочих дней на ставку в год (ТК РФ ст. 115). */
const VACATION_WORK_DAYS = 20;

/** Нерабочие праздники (ТК РФ ст. 112); выпавшие на выходные переносятся на понедельник. */
const HOLIDAY_MONTH_DAYS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [0, 6],
  [0, 7],
  [0, 8],
  [1, 23],
  [2, 8],
  [4, 1],
  [4, 9],
  [5, 12],
  [10, 4],
];

function holidaysFor(year: number): Set<string> {
  const out = new Set<string>();
  for (const [m, d] of HOLIDAY_MONTH_DAYS) {
    const date = new Date(Date.UTC(year, m, d));
    const dow = date.getUTCDay();
    if (dow === 6) date.setUTCDate(date.getUTCDate() + 2);
    else if (dow === 0) date.setUTCDate(date.getUTCDate() + 1);
    out.add(date.toISOString().slice(0, 10));
  }
  return out;
}

function workingDaysInMonth(year: number, month: number): number {
  const holidays = holidaysFor(year);
  let count = 0;
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(d.toISOString().slice(0, 10))) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/**
 * Доля годового отпуска, приходящаяся на месяц. Лето тяжёлое, январь и май
 * частично закрыты праздниками, поэтому отпусков там берут меньше.
 */
const VACATION_SHARE: Record<number, number> = {
  0: 0.04, // янв — праздники и так съедают месяц
  1: 0.04,
  2: 0.05,
  3: 0.06,
  4: 0.08, // май — длинные выходные догуливают отпуском
  5: 0.1,
  6: 0.18, // июль — пик
  7: 0.15, // август — пик
  8: 0.08,
  9: 0.06,
  10: 0.06,
  11: 0.1, // декабрь — добирают остатки до конца года
};

/** Продуктивных часов в неделю на ставку в конкретном месяце: 40ч минус праздники и отпуска. */
function hoursPerWeekFor(year: number, month: number): number {
  const workDays = workingDaysInMonth(year, month);
  const weeks = workDays / 5;
  const vacationDays = VACATION_WORK_DAYS * (VACATION_SHARE[month] ?? 1 / 12);
  const available = (workDays - vacationDays) * WORK_DAY_HOURS;
  return Math.round((available / weeks) * 10) / 10;
}

const ROLE_HEADCOUNT: Record<string, number> = {
  analyst: 6,
  engineer: 8,
  developer: 7,
  consultant: 4,
  architect: ARCHITECT_COUNT,
  pm: 3,
};

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

const CUSTOMERS = [
  'ПАО «Северный банк»',
  'АО «Энергосети Урала»',
  'ООО «Транслогистика»',
  'ПАО «Нефтехим»',
  'ФГУП «НИИ Прогресс»',
  'АО «Металлинвест»',
  'ООО «Ритейл Групп»',
  'ПАО «Телеком-Юг»',
  'АО «Агрохолдинг Дон»',
  'ГК «Мединдустрия»',
  'АО «Авиастроение»',
  'ООО «Страховой дом»',
  'ПАО «Горнорудная компания»',
  'АО «Портовый терминал»',
  'ФГБУ «Центр цифрового развития»',
  'ООО «Финтех Лаб»',
  'АО «Водоканал Столицы»',
  'ПАО «Химпром»',
];

const LOSS_REASONS = ['price', 'competitor', 'timing', 'no_budget', 'scope', 'relationship'];
const COMPETITORS = ['Крок', 'Ланит', 'Softline', 'Инфосистемы Джет', 'Т1 Интеграция', 'BI.ZONE'];

/** Смещение факта по типу задачи: документация переоценивается хронически. */
function taskBias(name: string): number {
  const n = name.toLowerCase();
  if (/документ|тз|пми|гост|отчёт|отчет|регламент/.test(n)) return 0.35;
  if (/пнр|пусконаладк|внедрен|настройк|миграц/.test(n)) return 0.2;
  if (/разработк|интеграц|доработк/.test(n)) return 0.15;
  if (/обследован|аудит|анализ|проектирован/.test(n)) return 0.1;
  if (/тестирован|испытан|приёмк|приемк/.test(n)) return -0.05;
  if (/обучен|поддержк/.test(n)) return 0.02;
  return 0.08;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ---------------------------------------------------------------------------

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  // --- Люди -----------------------------------------------------------------
  const presales: { id: string; username: string }[] = [];
  for (let i = 1; i <= PRESALE_COUNT; i++) {
    const username = `presale${String(i).padStart(2, '0')}`;
    const u = await prisma.user.upsert({
      where: { username },
      create: { username, role: 'presale', passwordHash: hash, mustChangePassword: false },
      update: { role: 'presale', passwordHash: hash, mustChangePassword: false },
    });
    presales.push({ id: u.id, username: u.username });
  }

  const architects: { id: string; username: string; bias: number }[] = [];
  // Разброс качества оценки: кто-то системно занижает, кто-то держит план.
  const ARCH_BIAS = [-0.08, 0.02, 0.12, 0.06, -0.03];
  for (let i = 1; i <= ARCHITECT_COUNT; i++) {
    const username = `arch${String(i).padStart(2, '0')}`;
    const u = await prisma.user.upsert({
      where: { username },
      create: { username, role: 'architect', passwordHash: hash, mustChangePassword: false },
      update: { role: 'architect', passwordHash: hash, mustChangePassword: false },
    });
    architects.push({ id: u.id, username: u.username, bias: ARCH_BIAS[i - 1] });
  }
  console.log(`Люди: ${presales.length} пресейлов, ${architects.length} архитекторов`);

  // --- Ёмкость на год -------------------------------------------------------
  await prisma.roleCapacity.deleteMany({ where: { createdBy: 'seed-portfolio' } });
  const capacityStart = new Date(Date.UTC(2026, 8, 1)); // сентябрь 2026
  const capacityRows: {
    role: string;
    headcount: number;
    hoursPerWeek: number;
    effectiveFrom: Date;
    note: string;
    createdBy: string;
  }[] = [];
  for (const [role, headcount] of Object.entries(ROLE_HEADCOUNT)) {
    for (let m = 0; m < 12; m++) {
      const d = new Date(
        Date.UTC(capacityStart.getUTCFullYear(), capacityStart.getUTCMonth() + m, 1),
      );
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth();
      const hpw = hoursPerWeekFor(year, month);
      capacityRows.push({
        role,
        headcount,
        hoursPerWeek: hpw,
        effectiveFrom: d,
        note: `40ч/нед минус праздники и отпуска (${workingDaysInMonth(year, month)} раб. дн.)`,
        createdBy: 'seed-portfolio',
      });
    }
  }
  await prisma.roleCapacity.createMany({ data: capacityRows });
  console.log(
    `Ёмкость: ${capacityRows.length} строк (${Object.keys(ROLE_HEADCOUNT).length} ролей × 12 мес)`,
  );

  // --- Чистка прошлого прогона ---------------------------------------------
  const old = await prisma.project.findMany({
    where: { code: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });
  if (old.length) {
    const ids = old.map((p) => p.id);
    const calcs = await prisma.calculation.findMany({
      where: { projectId: { in: ids } },
      select: { id: true },
    });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: calcs.map((c) => c.id) } } });
    await prisma.calculation.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
    console.log(`Снесён прошлый прогон: ${old.length} проектов`);
  }

  // --- Шаблоны --------------------------------------------------------------
  const templates = await prisma.formTemplate.findMany({
    include: { fields: true, stageTemplates: true, riskTemplates: true },
  });
  const usable = templates.filter((t) => t.stageTemplates.length > 0);
  if (!usable.length) throw new Error('Нет шаблонов с этапами — сначала импортируйте пресеты');

  // --- Проекты --------------------------------------------------------------
  let won = 0,
    lost = 0,
    open = 0,
    cancelled = 0;

  for (let i = 1; i <= PROJECT_COUNT; i++) {
    const template = usable[i % usable.length];
    const presale = presales[i % presales.length];
    const architect = architects[i % architects.length];
    const customer = pick(CUSTOMERS);

    // Ответы генерируются по реальным полям шаблона, а не по захардкоженным ключам.
    const answers: Record<string, unknown> = {};
    for (const f of template.fields) {
      if (f.type === 'number') {
        const k = f.key.toLowerCase();
        if (/endpoint|workstation|users/.test(k)) answers[f.key] = int(50, 4000);
        else if (/eps/.test(k)) answers[f.key] = int(500, 20000);
        else if (/server|screen|entit/.test(k)) answers[f.key] = int(4, 60);
        else answers[f.key] = int(1, 12);
      } else if (f.type === 'complexity') {
        answers[f.key] = pick(COMPLEXITY_OPTIONS);
      } else if (f.type === 'select') {
        const opts = JSON.parse(f.options || '[]') as string[];
        answers[f.key] = opts.length ? pick(opts) : '';
      } else if (f.type === 'textarea' || f.type === 'text') {
        answers[f.key] = `Демо-портфель, проект №${i}`;
      }
    }

    // Даты стартов раскиданы на 10 месяцев назад и 2 вперёд — иначе ресурсный
    // план упрётся в одну неделю, а воронка не даст динамики по периодам.
    const startDate = addDays(new Date(Date.UTC(2026, 8, 14)), int(-300, 60));

    // Скидка тянется первой, а исход зависит от неё вероятностно. Если делать
    // наоборот и назначать скидку по исходу, бакеты «скидка → исход» разъезжаются
    // идеально (win rate строго 0 и строго 1) и зависимость по ним не изучить.
    const discountPercent = int(0, 20);
    const pWin = 0.2 + discountPercent * 0.012;
    const roll = rnd();
    const dealStatus =
      roll < pWin ? 'won' : roll < pWin + 0.3 ? 'lost' : roll < pWin + 0.38 ? 'cancelled' : 'open';

    const project = await prisma.project.create({
      data: {
        name: `${template.name.split('(')[0].trim()} — ${customer.replace(/^(ПАО|АО|ООО|ФГУП|ГК|ФГБУ)\s*/, '').replace(/[«»]/g, '')}`,
        code: `${SEED_PREFIX}${String(i).padStart(3, '0')}`,
        customer,
        description: `Демо-проект №${i} для разбора воронки и отклонений`,
        status: dealStatus === 'won' ? 'completed' : dealStatus === 'open' ? 'active' : 'archived',
        createdBy: presale.username,
        dealStatus,
      },
    });

    const primary = primaryStagesFromTemplate(template.stageTemplates, answers);
    const pmHours = pmHoursFor(template.fields, answers, primary);

    const calculation = await prisma.calculation.create({
      data: {
        name: `${project.name} — оценка`,
        customer,
        templateId: template.id,
        answers: JSON.stringify(answers),
        status:
          dealStatus === 'open' ? pick(['draft', 'pending_approval', 'approved']) : 'approved',
        startDate,
        pmHours,
        createdBy: presale.username,
        projectId: project.id,
        marginPercent: template.defaultMarginPercent,
        discountPercent,
        createdAt: addDays(startDate, -int(3, 20)),
      },
    });

    const stages = await rebuildStages(
      calculation.id,
      primary,
      startDate,
      scheduleConfigFromTemplate(template),
    );

    const risks = risksFromTemplate(template.riskTemplates);
    if (risks.length) {
      await prisma.risk.createMany({
        data: risks.map((r) => ({ ...r, calculationId: calculation.id })),
      });
    }

    // Согласование архитектором — источник атрибуции в отчёте по отклонениям.
    if (calculation.status === 'approved') {
      await prisma.auditEvent.create({
        data: {
          actorType: 'user',
          actorId: architect.id,
          action: 'calculation.approve',
          entityType: 'calculation',
          entityId: calculation.id,
          meta: JSON.stringify({ username: architect.username }),
          at: addDays(startDate, -int(1, 5)),
        },
      });
    }

    if (dealStatus === 'won') {
      won++;
      const planHours = primary.reduce((s, p) => s + p.hours, 0) + pmHours;
      const lastEnd = stages.length ? stages[stages.length - 1].endDate : startDate;
      const closedAt = addDays(startDate, -int(1, 10));

      // Факт по этапам: смещение по типу задачи + почерк архитектора + шум.
      for (const s of stages) {
        if (s.isApprovalTask) continue;
        const dev = taskBias(s.name) + architect.bias + (rnd() - 0.5) * 0.36;
        const factor = Math.max(0.6, 1 + dev);
        const planDays = Math.max(
          1,
          Math.round((s.endDate.getTime() - s.startDate.getTime()) / 86400000),
        );
        const actualDays = Math.max(1, Math.round(planDays * Math.max(0.7, 1 + dev * 0.6)));
        await prisma.stage.update({
          where: { id: s.id },
          data: {
            actualHours: Math.round(s.hours * factor * 10) / 10,
            actualStartDate: addDays(s.startDate, int(-2, 4)),
            actualEndDate: addDays(s.startDate, actualDays + int(-1, 3)),
            status: 'done',
          },
        });
      }

      await prisma.calculation.update({
        where: { id: calculation.id },
        data: { actualPmHours: Math.round(pmHours * (1 + architect.bias + 0.1) * 10) / 10 },
      });

      const rate = 3200 + int(0, 900);
      await prisma.project.update({
        where: { id: project.id },
        data: {
          dealClosedAt: closedAt,
          dealClosedBy: presale.username,
          wonCalculationId: calculation.id,
          contractAmount: Math.round(planHours * rate * (1 - int(5, 18) / 100)),
          contractCurrency: 'RUB',
          actualsClosedAt: addDays(lastEnd, int(1, 15)),
        },
      });
    } else if (dealStatus === 'lost') {
      lost++;
      await prisma.project.update({
        where: { id: project.id },
        data: {
          dealClosedAt: addDays(startDate, -int(1, 10)),
          dealClosedBy: presale.username,
          lossReason: pick(LOSS_REASONS),
          competitor: rnd() < 0.6 ? pick(COMPETITORS) : null,
          lossComment: 'Демо-портфель: причина проставлена генератором',
        },
      });
    } else if (dealStatus === 'cancelled') {
      cancelled++;
      await prisma.project.update({
        where: { id: project.id },
        data: {
          dealClosedAt: addDays(startDate, -int(1, 10)),
          dealClosedBy: presale.username,
          lossComment: 'Заказчик снял задачу с бюджета',
        },
      });
    } else {
      open++;
    }

    if (i % 15 === 0) console.log(`  …${i}/${PROJECT_COUNT} проектов`);
  }

  console.log(
    `Проекты: ${PROJECT_COUNT} (выиграно ${won}, проиграно ${lost}, отменено ${cancelled}, в работе ${open})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
