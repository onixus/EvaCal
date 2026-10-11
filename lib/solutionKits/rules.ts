/**
 * Права и переходы статусов библиотеки решений (#103 WP-7a). Чистые функции:
 * маршруты и хранилище проверяют ими запрос до записи, а триггер
 * `SolutionKitVersion_guard` в БД дублирует неизменность утверждённых версий.
 *
 * Роли (docs/solution-library.md):
 * - читать библиотеку, создавать наборы и править черновики — `architect`, `admin`;
 * - утверждать версию, архивировать версию или набор, править паспорт —
 *   `admin` или владелец набора с ролью `architect`.
 * У системного набора (ownerId = null, импорт из кода) владельца нет —
 * эти действия доступны только администратору.
 */
export const KIT_STATUSES = ['draft', 'approved', 'archived'] as const;
export type KitStatus = (typeof KIT_STATUSES)[number];
export const KIT_VERSION_STATUSES = ['draft', 'approved', 'archived'] as const;
export type KitVersionStatus = (typeof KIT_VERSION_STATUSES)[number];

export const KIT_STATUS_LABELS: Record<KitStatus, string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  archived: 'В архиве',
};

export const KIT_VERSION_STATUS_LABELS: Record<KitVersionStatus, string> = {
  draft: 'Черновик',
  approved: 'Утверждена',
  archived: 'В архиве',
};

/** Роли, допущенные к библиотеке решений (API и /admin/solution-kits). */
export const KIT_LIBRARY_ROLES = ['admin', 'architect'] as const;

export interface KitActor {
  userId: string;
  role: string;
}

export function canUseKitLibrary(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'architect';
}

/** Создать набор, создать и править черновик версии. */
export function canEditKitDrafts(actor: KitActor): boolean {
  return canUseKitLibrary(actor.role);
}

/** Утвердить версию, архивировать версию/набор, сменить паспорт и владельца. */
export function canGovernKit(actor: KitActor, kit: { ownerId: string | null }): boolean {
  if (actor.role === 'admin') return true;
  return actor.role === 'architect' && kit.ownerId !== null && kit.ownerId === actor.userId;
}

/**
 * Допустимые переходы статуса версии: draft → approved, approved → archived.
 * Архивная версия не меняется; возврата в черновик нет — правка утверждённого
 * содержимого идёт новой версией.
 */
export function canTransitionVersion(from: KitVersionStatus, to: KitVersionStatus): boolean {
  return (from === 'draft' && to === 'approved') || (from === 'approved' && to === 'archived');
}

/** Содержимое и журнал изменений правятся только в черновике. */
export function isVersionEditable(status: string): boolean {
  return status === 'draft';
}

/** Переходы статуса набора: архивирование и возврат из архива. */
export function nextKitStatusOnRestore(hasApproved: boolean): KitStatus {
  return hasApproved ? 'approved' : 'draft';
}
