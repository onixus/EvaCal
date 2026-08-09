import { finding, RequirementCheck } from '../context';
import type { ValidationFinding } from '../types';

/** Минимальная осмысленная длина формулировки требования. */
const MIN_TEXT_LENGTH = 15;

/** Требование начинается с обязывающего глагола — субъект не назван. */
const MISSING_SUBJECT_PATTERN =
  /^(?:должн[а-яё]*|обязан[а-яё]*|необходимо|следует|требуется|обеспеч[а-яё]+)/iu;

/**
 * Полнота: у требования должны быть идентификатор, субъект и обязывающая формулировка.
 */
export function checkCompleteness(check: RequirementCheck): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const { requirement, text } = check;

  if (!requirement.code?.trim()) {
    findings.push(
      finding(
        check,
        'completeness',
        'ERROR',
        'У требования нет обозначения (кода), на него нельзя сослаться.',
        'Присвоить код вида «ТР-ФУНК-01».',
      ),
    );
  }

  if (!text) {
    findings.push(
      finding(
        check,
        'completeness',
        'ERROR',
        'Текст требования пуст.',
        'Заполнить формулировку требования или удалить запись.',
      ),
    );
    return findings;
  }

  if (text.length < MIN_TEXT_LENGTH) {
    findings.push(
      finding(
        check,
        'completeness',
        'ERROR',
        `Формулировка слишком короткая (${text.length} симв.) и не описывает требование.`,
        'Указать субъект, действие и условие: «Система должна … при …».',
      ),
    );
  }

  if (!check.hasModal) {
    findings.push(
      finding(
        check,
        'completeness',
        'ERROR',
        'Текст не выражен как требование: отсутствует обязывающая формулировка («должна», «обязана»).',
        'Переформулировать в виде «Система должна …» либо перенести текст в пояснительную часть.',
      ),
    );
  } else if (MISSING_SUBJECT_PATTERN.test(text)) {
    findings.push(
      finding(
        check,
        'completeness',
        'WARNING',
        'Не указан субъект требования: непонятно, к чему предъявляется требование.',
        'Начать формулировку с субъекта: «Система должна …», «Подсистема мониторинга должна …».',
      ),
    );
  }

  if (!requirement.title?.trim()) {
    findings.push(
      finding(
        check,
        'completeness',
        'WARNING',
        'У требования нет заголовка.',
        'Добавить краткий заголовок для оглавления и таблиц трассируемости.',
      ),
    );
  }

  return findings;
}
