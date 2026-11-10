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

const ROLE_VALUES = new Set<string>(ROLES.map((r) => r.value));

// Stages performed by these roles require a customer sign-off task before the next stage starts.
export const APPROVAL_REQUIRED_ROLES: Role[] = ['consultant', 'developer', 'engineer', 'analyst'];

export const APPROVAL_BUSINESS_DAYS = 3;

/**
 * Canonical role only when the string itself is a Role value.
 * No synonyms: unknown text stays null so pricing can fall back to `other`.
 */
export function canonicalRole(roleStr: string): Role | null {
  const key = roleStr.trim().toLowerCase();
  return ROLE_VALUES.has(key) ? (key as Role) : null;
}

/** Слово или фраза целиком, не подстрока внутри другого слова (`engineer` ⊄ `engineering`). */
function hasToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

/**
 * Maps a role string (including grades: Lead, Senior, GAP, Expert) to a canonical Role key.
 * Tokens match on word boundaries so a longer unknown word does not inherit a paid role.
 */
export function normalizeRoleKey(roleStr: string): Role {
  if (!roleStr) return 'other';
  const lower = roleStr.toLowerCase();
  const exact = canonicalRole(lower);
  if (exact) return exact;

  const has = (token: string) => hasToken(lower, token);

  if (
    ['гап', 'архитектор', 'architect', 'техлид'].some(has) ||
    /главн\p{L}* архитект\p{L}*/iu.test(lower) ||
    /ведущ\p{L}* архитект\p{L}*/iu.test(lower) ||
    hasToken(lower, 'solution architect') ||
    hasToken(lower, 'enterprise architect')
  ) {
    return 'architect';
  }
  if (
    has('рп') ||
    hasToken(lower, 'project manager') ||
    hasToken(lower, 'менеджер проекта') ||
    /руководител\p{L}* проект\p{L}*/iu.test(lower)
  ) {
    return 'pm';
  }
  if (
    ['разработчик', 'программист', 'developer', 'frontend', 'backend'].some(has) ||
    hasToken(lower, 'software engineer')
  ) {
    return 'developer';
  }
  if (
    ['аналитик', 'analyst'].some(has) ||
    hasToken(lower, 'системный аналитик') ||
    hasToken(lower, 'бизнес-аналитик')
  ) {
    return 'analyst';
  }
  if (['консультант', 'consultant', 'эксперт', 'аудитор'].some(has)) {
    return 'consultant';
  }
  if (
    ['инженер', 'engineer', 'девопс', 'devops', 'монтаж', 'пнр', 'иб'].some(has) ||
    hasToken(lower, 'системный админ') ||
    /защит\p{L}* информац\p{L}*/iu.test(lower)
  ) {
    return 'engineer';
  }
  if (['заказчик', 'customer'].some(has)) {
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
