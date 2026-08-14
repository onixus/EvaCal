export const ROLES = [
  { value: 'consultant', label: 'Консультант / Эксперт' },
  { value: 'developer', label: 'Разработчик' },
  { value: 'engineer', label: 'Инженер / Специалист' },
  { value: 'analyst', label: 'Аналитик' },
  { value: 'architect', label: 'Архитектор / ГАП' },
  { value: 'pm', label: 'Руководитель проекта (РП)' },
  { value: 'customer', label: 'Заказчик' },
  { value: 'other', label: 'Другое' },
] as const;

export type Role = (typeof ROLES)[number]['value'];

// Stages performed by these roles require a customer sign-off task before the next stage starts.
export const APPROVAL_REQUIRED_ROLES: Role[] = ['consultant', 'developer', 'engineer', 'analyst'];

export const APPROVAL_BUSINESS_DAYS = 3;

/**
 * Maps any role string (including grades: Lead, Senior, GAP, Expert) to a canonical Role key.
 */
export function normalizeRoleKey(roleStr: string): Role {
  if (!roleStr) return 'other';
  const lower = roleStr.toLowerCase();

  if (
    /гап|главный архитект|ведущий архитект|архитект|architect|solution architect|enterprise architect|техлид/i.test(
      lower,
    )
  ) {
    return 'architect';
  }
  if (/рп|руководител.*проек|project manager|менеджер проекта/i.test(lower)) {
    return 'pm';
  }
  if (/разработ|программист|developer|software engineer|frontend|backend/i.test(lower)) {
    return 'developer';
  }
  if (/аналитик|analyst|системный аналитик|бизнес-аналитик/i.test(lower)) {
    return 'analyst';
  }
  if (/консультант|consultant|эксперт|аудитор/i.test(lower)) {
    return 'consultant';
  }
  if (/инженер|engineer|системный админ|девопс|devops|монтаж|пнр|иб|защит.*информ/i.test(lower)) {
    return 'engineer';
  }
  if (/заказчик|customer/i.test(lower)) {
    return 'customer';
  }

  return 'other';
}

export function roleLabel(role: string): string {
  const matched = ROLES.find((r) => r.value === role);
  if (matched) return matched.label;

  const normalized = normalizeRoleKey(role);
  return ROLES.find((r) => r.value === normalized)?.label ?? role;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  pending_approval: 'На согласовании',
  approved: 'Утверждён',
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Выполнено',
  rejected: 'Отклонено',
};
