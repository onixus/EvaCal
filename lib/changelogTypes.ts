/**
 * Чистая часть листа внутренних изменений: типы, подписи и форматирование.
 *
 * Вынесено из `lib/changelog.ts` потому, что тот импортирует Prisma-клиент, а
 * экран листа — клиентский компонент: импорт подписей источника оттуда тянул
 * бы в браузерный бандл драйвер SQLite.
 */

/** Что породило запись. Совпадает с колонкой «Источник» в выгрузке. */
export type ChangeSource =
  'upload' | 'tw-edit' | 'studio-inline' | 'calculation' | 'release' | 'review';

export const CHANGE_SOURCE_LABELS: Record<ChangeSource, string> = {
  upload: 'загрузка версии',
  'tw-edit': 'правка тех.писа',
  'studio-inline': 'студия · inline',
  calculation: 'расчёт',
  release: 'выпуск',
  review: 'решение ревью',
};

/** Цветовая семантика чипа источника: правки тех.писателя выделяются. */
export const CHANGE_SOURCE_TONE: Record<ChangeSource, 'ok' | 'muted'> = {
  upload: 'ok',
  'tw-edit': 'ok',
  'studio-inline': 'muted',
  calculation: 'muted',
  release: 'muted',
  review: 'muted',
};

export interface InternalChangeRow {
  id: string;
  /** Печатный номер вида «И-01». */
  num: string;
  seq: number;
  occurredAt: string;
  author: string;
  role: string;
  roleLabel: string;
  docRef: string;
  text: string;
  source: ChangeSource;
  sourceLabel: string;
  packageId: string | null;
}

export function formatChangeNumber(seq: number): string {
  return `И-${String(seq).padStart(2, '0')}`;
}

export function isChangeSource(value: string): value is ChangeSource {
  return value in CHANGE_SOURCE_LABELS;
}
