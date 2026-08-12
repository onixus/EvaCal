import type { WizardStepDefinition, WizardStepId } from './types';

/**
 * Порядок шагов мастера. Он же порядок вкладок в UI и порядок разделов на
 * итоговом экране соответствия.
 */
export const WIZARD_STEPS: WizardStepDefinition[] = [
  {
    id: 'profile',
    order: 1,
    title: 'Нормативный профиль',
    subtitle: 'Редакция ГОСТ 34, тип документа и оформление',
  },
  {
    id: 'requirements',
    order: 2,
    title: 'Требования',
    subtitle: 'Импорт, нормализация и проверка формулировок',
  },
  {
    id: 'applicability',
    order: 3,
    title: 'Применимость нормативов',
    subtitle: 'Подтверждение отраслевых и регуляторных требований',
  },
  {
    id: 'traceability',
    order: 4,
    title: 'Трассируемость',
    subtitle: 'Связи «требование → этап работ» и покрытие',
  },
  {
    id: 'signatures',
    order: 5,
    title: 'Реквизиты и подписи',
    subtitle: 'Основная надпись по ГОСТ 2.104',
  },
  {
    id: 'compliance',
    order: 6,
    title: 'Соответствие и выпуск',
    subtitle: 'Итоговая проверка и экспорт',
  },
];

export const WIZARD_STEP_IDS: WizardStepId[] = WIZARD_STEPS.map((step) => step.id);

export function getWizardStep(id: WizardStepId): WizardStepDefinition {
  const step = WIZARD_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`Unknown wizard step: ${id}`);
  return step;
}

/** Соседний шаг в заданном направлении либо `undefined` на краю мастера. */
export function adjacentWizardStep(
  id: WizardStepId,
  direction: 'next' | 'prev',
): WizardStepId | undefined {
  const index = WIZARD_STEP_IDS.indexOf(id);
  if (index < 0) return undefined;
  return WIZARD_STEP_IDS[direction === 'next' ? index + 1 : index - 1];
}
