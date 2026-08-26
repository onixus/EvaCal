/**
 * Роли пользователей платформы — не путать с производственными ролями из
 * `lib/roles.ts` (там роли исполнителей на этапах: инженер, аналитик, …).
 *
 * До рефакторинга UI логин выдавал только `architect` и `admin`. Пресейл
 * работал анонимно или под архитектором, а ревью документации отдельной роли
 * не имело вовсе. Ролевая навигация требует, чтобы обе роли были явными:
 * пресейл видит мастер расчёта, ревьювер — очередь нормоконтроля.
 */
export type AppRole = 'presale' | 'architect' | 'reviewer' | 'admin';

export const APP_ROLES: { value: AppRole; label: string; description: string }[] = [
  {
    value: 'presale',
    label: 'Пресейл',
    description: 'Опросники, расчёты трудозатрат и сметы КП',
  },
  {
    value: 'architect',
    label: 'Архитектор',
    description: 'Студия ГОСТ 34, финальное ревью ГАП, архитектурный каталог',
  },
  {
    value: 'reviewer',
    label: 'Ревьювер документации',
    description: 'Нормоконтроль комплектов, чек-листы и версия тех.писателя',
  },
  {
    value: 'admin',
    label: 'Администратор',
    description: 'Шаблоны, пользователи и настройки платформы',
  },
];

export function isAppRole(value: string | null | undefined): value is AppRole {
  return APP_ROLES.some((role) => role.value === value);
}

export function appRoleLabel(role: string | null | undefined): string {
  return APP_ROLES.find((r) => r.value === role)?.label ?? 'Гость';
}

/**
 * Администратор — надмножество архитектора: он открывает те же экраны и
 * дополнительно администрирование. Проверки прав пишутся через эту функцию,
 * чтобы не перечислять `['architect', 'admin']` в каждом роуте.
 */
export function hasArchitectPowers(role: string | null | undefined): boolean {
  return role === 'architect' || role === 'admin';
}

/** Нормоконтроль ведут ревьюверы; архитектор и админ видят те же экраны для второго этапа. */
export function hasReviewerPowers(role: string | null | undefined): boolean {
  return role === 'reviewer' || hasArchitectPowers(role);
}

/**
 * Тему Dark Fantasy включает администратор, и доступна она архитекторам и
 * администраторам. Для остальных ролей пункт показывается заблокированным —
 * пользователь видит, что тема существует, но не может её включить.
 */
export function canUseDarkFantasy(role: string | null | undefined): boolean {
  return hasArchitectPowers(role);
}

/** Экран, на который роль попадает после входа. */
export const ROLE_HOME: Record<AppRole, string> = {
  presale: '/presale',
  architect: '/projects',
  reviewer: '/review',
  admin: '/admin',
};

export interface NavItem {
  href: string;
  label: string;
  /** Ключ счётчика из `/api/nav/badges`; пункт без ключа бейдж не показывает. */
  badgeKey?: 'studioDrafts' | 'reviewQueue' | 'gapQueue';
}

/**
 * Навигация зависит от роли: у каждой свой набор экранов и свой порядок. Общие
 * пункты («Проекты», «Расчёты и сметы») повторяются намеренно — это входная
 * точка и для пресейла, и для архитектора.
 */
export const NAV_BY_ROLE: Record<AppRole, NavItem[]> = {
  presale: [
    { href: '/projects', label: 'Проекты' },
    { href: '/presale', label: 'Пресейл-мастер' },
    { href: '/', label: 'Расчёты и сметы' },
  ],
  architect: [
    { href: '/projects', label: 'Проекты' },
    { href: '/', label: 'Расчёты и сметы' },
    { href: '/studio', label: 'Студия ГОСТ 34', badgeKey: 'studioDrafts' },
    { href: '/review', label: 'Финальное ревью (ГАП)', badgeKey: 'gapQueue' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/architect', label: 'Архитектурный каталог' },
    { href: '/agents', label: 'Харнесс-агенты' },
  ],
  reviewer: [
    { href: '/review', label: 'Очередь ревью', badgeKey: 'reviewQueue' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/standards', label: 'Чек-листы и стандарты' },
  ],
  admin: [
    { href: '/projects', label: 'Проекты' },
    { href: '/', label: 'Расчёты и сметы' },
    { href: '/studio', label: 'Студия ГОСТ 34', badgeKey: 'studioDrafts' },
    { href: '/review', label: 'Ревью документации', badgeKey: 'reviewQueue' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/architect', label: 'Архитектурный каталог' },
    { href: '/agents', label: 'Харнесс-агенты' },
    { href: '/admin', label: 'Шаблоны и пользователи' },
  ],
};

export function navItemsFor(role: string | null | undefined): NavItem[] {
  return isAppRole(role) ? NAV_BY_ROLE[role] : [];
}
