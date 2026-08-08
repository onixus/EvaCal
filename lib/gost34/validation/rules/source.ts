import { finding, RequirementCheck } from '../context';
import type { ValidationFinding } from '../types';

function hasLocator(check: RequirementCheck): boolean {
  const source = check.requirement.source;
  if (!source) return false;

  return Boolean(
    source.documentId || source.filename || source.section || source.paragraph || source.locator
  );
}

/** Требование создано машиной (LLM-предложение или правило), а не внесено вручную. */
function isMachineProposed(check: RequirementCheck): boolean {
  const { approval, confidence } = check.requirement;
  return approval.status === 'PROPOSED' || (confidence !== undefined && confidence < 1);
}

/**
 * Прослеживаемость до источника. Требование без источника нельзя ни проверить
 * на актуальность, ни защитить перед заказчиком.
 */
export function checkSource(check: RequirementCheck): ValidationFinding[] {
  if (check.isLibrary) {
    if (check.requirement.standardReferences?.length) return [];

    return [
      finding(
        check,
        'source',
        'INFO',
        'Нормативное требование из встроенной библиотеки: пункт нормативного акта не указан.',
        'Добавить ссылку на конкретный пункт нормативного документа в standardReferences.'
      ),
    ];
  }

  if (hasLocator(check)) return [];

  if (isMachineProposed(check)) {
    return [
      finding(
        check,
        'source',
        'ERROR',
        'Машинно-сформированное требование не ссылается на источник.',
        'Указать документ и раздел исходного текста либо отклонить предложение.'
      ),
    ];
  }

  if (check.requirement.source?.hash) {
    return [
      finding(
        check,
        'source',
        'WARNING',
        'Источник задан только хэшем: документ и раздел не восстанавливаются.',
        'Дополнить источник именем документа и разделом.'
      ),
    ];
  }

  return [
    finding(
      check,
      'source',
      'WARNING',
      'Не указан источник требования.',
      'Указать документ, раздел или пункт, из которого взято требование.'
    ),
  ];
}
