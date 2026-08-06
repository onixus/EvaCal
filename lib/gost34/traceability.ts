import { Gost34RequirementItem, Gost34StageItem, Gost34TableData } from './types';

/**
 * Automatically maps vendor requirements to project stages based on keywords and role matches.
 */
export function autoMapRequirementsToStages(
  requirements: Gost34RequirementItem[],
  stages: Gost34StageItem[]
): Gost34RequirementItem[] {
  if (!stages || stages.length === 0) return requirements;

  return requirements.map((req) => {
    if (req.mappedStageName) return req; // already explicitly mapped

    let matchedStage: Gost34StageItem | undefined = undefined;

    const lowerDesc = `${req.title} ${req.description}`.toLowerCase();

    // Match keywords to stage names or roles
    if (/безопасн|152-фз|фстэк|авториз|права|шифр/i.test(lowerDesc)) {
      matchedStage = stages.find((s) => /безопасн|защит|инженер/i.test(`${s.name} ${s.role}`));
    } else if (/субд|бд|данны|postgresql|sqlite|схема/i.test(lowerDesc)) {
      matchedStage = stages.find((s) => /бд|данн|архитект|разработ/i.test(`${s.name} ${s.role}`));
    } else if (/интерфейс|веб|дизайн|экран|форма|wcag/i.test(lowerDesc)) {
      matchedStage = stages.find((s) => /интерфейс|фронт|разработ|дизайн/i.test(`${s.name} ${s.role}`));
    } else if (/испытан|пми|приемк|тестиров/i.test(lowerDesc)) {
      matchedStage = stages.find((s) => /тест|испытан|аналитик/i.test(`${s.name} ${s.role}`));
    }

    // Default to first matching stage or first stage
    if (!matchedStage) {
      matchedStage = stages[Math.min(stages.length - 1, Math.abs(hashCode(req.code)) % stages.length)];
    }

    return {
      ...req,
      mappedStageId: matchedStage?.id,
      mappedStageName: matchedStage?.name || stages[0].name,
      mappedRole: matchedStage?.role || stages[0].role,
    };
  });
}

/**
 * Generates a formal ГОСТ 34 Traceability Matrix table (Матрица прослеживаемости требований)
 */
export function generateTraceabilityTable(
  requirements: Gost34RequirementItem[],
  stages: Gost34StageItem[]
): Gost34TableData {
  const mappedReqs = autoMapRequirementsToStages(requirements, stages);

  return {
    caption: 'Таблица — Матрица прослеживаемости требований вендора и этапов проекта',
    headers: ['Код требования', 'Вендорское требование', 'Ответственный этап работ', 'Роль исполнителя', 'Источник'],
    rows: mappedReqs.map((r) => [
      r.code,
      r.title,
      r.mappedStageName || 'Общий этап',
      r.mappedRole || 'разработчик',
      r.sourceFile || 'ТЗ',
    ]),
  };
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
