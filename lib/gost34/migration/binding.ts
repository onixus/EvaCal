import {
  CURRENT_GOST34_PROFILE_ID,
  LEGACY_GOST34_PROFILE_ID,
  getGost34Profile,
  resolveGost34Profile,
} from '../standards';
import type { ProjectStandardBinding, ProjectStandardBindingRecord } from './types';

/**
 * Версия генератора документов. Растёт при изменении структуры выпускаемых
 * документов, а не при правках вёрстки: по ней видно, каким кодом выпущен
 * лежащий у Заказчика комплект.
 */
export const GOST34_GENERATOR_VERSION = '2.0.0';

/**
 * Профиль, которым читаются проекты без сохранённой привязки. Такие проекты
 * выпускались до реестра профилей, то есть по редакции 1989 года.
 */
export const INFERRED_LEGACY_PROFILE_ID = LEGACY_GOST34_PROFILE_ID;

/** Профиль, на который ведёт миграция. */
export const MIGRATION_TARGET_PROFILE_ID = CURRENT_GOST34_PROFILE_ID;

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Восстанавливает нормативную привязку проекта. Отсутствие сохранённого
 * профиля — это не ошибка, а признак проекта, выпущенного до модернизации:
 * такой проект читается как legacy и помечается `inferred`.
 */
export function resolveProjectBinding(
  record?: ProjectStandardBindingRecord | null,
): ProjectStandardBinding {
  const storedId = record?.standardProfileId || null;
  const known = storedId ? getGost34Profile(storedId) : undefined;
  const profile = known || resolveGost34Profile(INFERRED_LEGACY_PROFILE_ID);

  return {
    standardProfileId: profile.id,
    // Сохранённая версия важнее текущей: профиль в реестре мог быть обновлён.
    standardProfileVersion: (known && record?.standardProfileVersion) || profile.version,
    generatorVersion: record?.generatorVersion || 'legacy',
    generatedAt: toIsoDate(record?.generatedAt),
    inferred: !known,
  };
}

/**
 * Значения полей привязки для записи в расчёт после выпуска или миграции.
 * `generatedAt` передаётся снаружи, чтобы вызывающий код владел временем.
 */
export function buildBindingUpdate(
  standardProfileId?: string,
  generatedAt: Date = new Date(),
): {
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  generatedAt: Date;
} {
  const profile = resolveGost34Profile(standardProfileId);
  return {
    standardProfileId: profile.id,
    standardProfileVersion: profile.version,
    generatorVersion: GOST34_GENERATOR_VERSION,
    generatedAt,
  };
}

/** Проект уже выпускается по действующему профилю. */
export function isMigrated(binding: ProjectStandardBinding): boolean {
  return binding.standardProfileId === MIGRATION_TARGET_PROFILE_ID;
}
