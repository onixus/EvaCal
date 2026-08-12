/**
 * Миграция ранее выпущенных проектов на действующий нормативный профиль
 * (раздел 5 плана модернизации, PR-12).
 *
 * Модуль ничего не переписывает молча: он вычисляет разницу между документом,
 * выпущенным по прежнему профилю, и документом, который будет выпущен по
 * действующему, и только после подтверждения меняет привязку проекта.
 */

import type { GostDocumentType } from '../types';
import type { SchemaValidationIssue } from '../schema/types';
import type { ValidationFinding } from '../validation/types';
import type { ApplicabilityStatus } from '../applicability/types';

/**
 * Нормативная привязка проекта: чем и по какой редакции выпускался комплект.
 * Хранится в расчёте (`Calculation`), чтобы повторный выпуск и миграция не
 * зависели от текущих значений по умолчанию.
 */
export interface ProjectStandardBinding {
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  /** ISO-строка даты последнего выпуска; `null`, если комплект ещё не выпускался. */
  generatedAt: string | null;
  /**
   * Привязка восстановлена по правилу умолчания, а не прочитана из проекта:
   * так помечаются проекты, созданные до появления реестра профилей.
   */
  inferred: boolean;
}

/** Поля привязки в том виде, в каком они лежат в расчёте. */
export interface ProjectStandardBindingRecord {
  standardProfileId?: string | null;
  standardProfileVersion?: string | null;
  generatorVersion?: string | null;
  generatedAt?: Date | string | null;
}

/** Краткая ссылка на нормативный профиль для отображения в diff. */
export interface MigrationProfileRef {
  id: string;
  name: string;
  version: string;
  primaryStandard: string;
}

/** Раздел документа в терминах diff: номер и заголовок. */
export interface MigrationSectionRef {
  id: string;
  numStr: string;
  title: string;
}

/** Раздел, сменивший позицию в структуре документа. */
export interface MigrationSectionMove extends MigrationSectionRef {
  /** Номер раздела в документе прежнего профиля. */
  previousNumStr: string;
}

export interface MigrationStructureDiff {
  added: MigrationSectionRef[];
  removed: MigrationSectionRef[];
  renumbered: MigrationSectionMove[];
  /** Число разделов, сохранившихся без изменения номера. */
  unchanged: number;
}

export interface MigrationRequirementRef {
  code: string;
  title: string;
  category: string;
}

/** Ссылка на норматив прежней редакции, исчезающая из документа. */
export interface MigrationReferenceChange {
  /** Обозначение стандарта, например «ГОСТ 34.602-89». */
  citation: string;
  /** Чем норматив заменён в действующем профиле, если замена известна. */
  replacedBy?: string;
}

/** Норматив, применимость которого не подтверждена после миграции. */
export interface MigrationApplicabilityGap {
  standardId: string;
  title: string;
  status: Exclude<ApplicabilityStatus, 'APPLICABLE'>;
  reason: string;
}

/**
 * Полный предварительный просмотр миграции. Показывается пользователю до
 * того, как привязка проекта будет изменена.
 */
export interface MigrationDiff {
  docType: GostDocumentType;
  from: MigrationProfileRef;
  to: MigrationProfileRef;
  /** Профиль проекта уже совпадает с целевым — мигрировать нечего. */
  alreadyMigrated: boolean;
  structure: MigrationStructureDiff;
  /** Ссылки на нормативы прежней редакции, которых не будет в новом документе. */
  removedLegacyReferences: MigrationReferenceChange[];
  addedRequirements: MigrationRequirementRef[];
  removedRequirements: MigrationRequirementRef[];
  /** Замечания валидатора уровня ERROR к требованиям целевого документа. */
  conflicts: ValidationFinding[];
  /** Нарушения структуры целевого документа относительно схемы профиля. */
  schemaIssues: SchemaValidationIssue[];
  /** Нормативы со статусом NOT_APPLICABLE / UNKNOWN после миграции. */
  inapplicableRegulations: MigrationApplicabilityGap[];
  /** Незаполненные сведения проектного контекста, блокирующие выпуск. */
  blockingGaps: { path: string; label: string }[];
  /**
   * Миграцию можно выполнить, но документ ещё не готов к согласованию:
   * есть отсутствующие обязательные разделы, конфликты или блокирующие пробелы.
   */
  requiresAttention: boolean;
}

/** Результат применения миграции. */
export interface MigrationResult {
  binding: ProjectStandardBinding;
  diff: MigrationDiff;
}
