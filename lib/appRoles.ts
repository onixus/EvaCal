/**
 * Роли пользователей платформы — не путать с производственными ролями из
 * `lib/roles.ts` (там роли исполнителей на этапах: инженер, аналитик, …).
 *
 * До рефакторинга UI логин выдавал только `architect` и `admin`. Пресейл
 * работал анонимно или под архитектором, а ревью документации отдельной роли
 * не имело вовсе. Ролевая навигация требует, чтобы обе роли были явными:
 * пресейл видит мастер расчёта, ревьювер — очередь нормоконтроля.
 *
 * Обе подписи под комплектом теперь тоже носят отдельные роли. Раньше ГАП был
 * функцией архитектора, а нормоконтроль — функцией ревьювера, и одно лицо
 * могло совместить выпуск с подписью. `techwriter` и `gap` — единственные
 * носители своих этапов ревью; архитектор выпускает комплект, но не
 * подписывает его, ревьювер готовит нормоконтроль, но не выносит вердикт.
 */
export type AppRole = 'presale' | 'architect' | 'techwriter' | 'gap' | 'reviewer' | 'admin';

export const APP_ROLES: { value: AppRole; label: string; description: string }[] = [
  {
    value: 'presale',
    label: 'Пресейл',
    description: 'Опросники, расчёты трудозатрат и сметы КП',
  },
  {
    value: 'architect',
    label: 'Архитектор',
    description: 'Студия ГОСТ 34, выпуск комплектов, архитектурный каталог',
  },
  {
    value: 'techwriter',
    label: 'Технический писатель',
    description: 'Нормоконтроль комплектов: чек-лист, замечания, вычитанная версия',
  },
  {
    value: 'gap',
    label: 'ГАП (главный архитектор проекта)',
    description: 'Финальное ревью и подпись выпуска по итогам нормоконтроля',
  },
  {
    value: 'reviewer',
    label: 'Рецензент документации',
    description: 'Читает комплекты и ведёт замечания; вердикт выносят тех.писатель и ГАП',
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

/**
 * Кто вообще допущен к экранам ревью комплектов. Право открыть и вести
 * черновик нормоконтроля шире права вынести вердикт: вердикт закреплён за
 * ролью этапа (см. `REVIEW_STAGE_ROLES` в `lib/gost34/review/types`).
 */
export function hasReviewerPowers(role: string | null | undefined): boolean {
  return role === 'techwriter' || role === 'gap' || role === 'reviewer' || hasArchitectPowers(role);
}

/** Роли, работающие с очередью нормоконтроля (первый этап). */
export function isTechWriterRole(role: string | null | undefined): boolean {
  return role === 'techwriter' || role === 'reviewer';
}

/** Роли, работающие с очередью финального ревью (второй этап). */
export function isGapRole(role: string | null | undefined): boolean {
  return role === 'gap' || hasArchitectPowers(role);
}

/**
 * Этап, очередь которого роль видит по умолчанию на экране `/review`.
 * Архитектор попадает на очередь ГАП как наблюдатель: там его выпуски.
 */
export function defaultReviewStageFor(role: string | null | undefined): 'tw' | 'gap' {
  return isTechWriterRole(role) ? 'tw' : 'gap';
}

/**
 * Тема Dark Fantasy доступна только архитекторам и администраторам (staff).
 * Для остальных пользователей (пресейл, ревьювер, гости) она полностью скрыта
 * из интерфейса, чтобы не засорять UI недоступным функционалом.
 */
export function canUseDarkFantasy(role: string | null | undefined): boolean {
  return hasArchitectPowers(role);
}

/** Экран, на который роль попадает после входа. */
export const ROLE_HOME: Record<AppRole, string> = {
  presale: '/presale',
  architect: '/projects',
  techwriter: '/review',
  gap: '/review',
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
    { href: '/analytics', label: 'Сделки и точность' },
    { href: '/leaderboard', label: 'Рейтинг команды' },
  ],
  architect: [
    { href: '/projects', label: 'Проекты' },
    { href: '/', label: 'Расчёты и сметы' },
    { href: '/studio', label: 'Студия ГОСТ 34', badgeKey: 'studioDrafts' },
    // Архитектор выпускает комплект, но подпись ставит ГАП: пункт ведёт на ту
    // же очередь как наблюдательный — видно, где стоят его выпуски.
    { href: '/review', label: 'Комплекты на подписи', badgeKey: 'gapQueue' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/architect', label: 'Архитектурный каталог' },
    { href: '/agents', label: 'Харнесс-агенты' },
    { href: '/capacity', label: 'Ресурсный план' },
    { href: '/analytics', label: 'Сделки и точность' },
    { href: '/leaderboard', label: 'Рейтинг команды' },
  ],
  techwriter: [
    { href: '/review', label: 'Очередь нормоконтроля', badgeKey: 'reviewQueue' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/standards', label: 'Чек-листы и стандарты' },
    { href: '/capacity', label: 'Ресурсный план' },
    { href: '/analytics', label: 'Сделки и точность' },
    { href: '/leaderboard', label: 'Рейтинг команды' },
  ],
  gap: [
    { href: '/review', label: 'Финальное ревью (ГАП)', badgeKey: 'gapQueue' },
    { href: '/projects', label: 'Проекты' },
    { href: '/', label: 'Расчёты и сметы' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/standards', label: 'Чек-листы и стандарты' },
    { href: '/capacity', label: 'Ресурсный план' },
    { href: '/analytics', label: 'Сделки и точность' },
    { href: '/leaderboard', label: 'Рейтинг команды' },
  ],
  reviewer: [
    { href: '/review', label: 'Очередь ревью', badgeKey: 'reviewQueue' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/standards', label: 'Чек-листы и стандарты' },
    { href: '/capacity', label: 'Ресурсный план' },
    { href: '/analytics', label: 'Сделки и точность' },
    { href: '/leaderboard', label: 'Рейтинг команды' },
  ],
  admin: [
    { href: '/projects', label: 'Проекты' },
    { href: '/', label: 'Расчёты и сметы' },
    { href: '/studio', label: 'Студия ГОСТ 34', badgeKey: 'studioDrafts' },
    // Админ ведёт оба этапа, но экран открывает очередь ГАП (`defaultReviewStageFor`),
    // поэтому и счётчик у пункта — по ней: иначе число не совпадало бы со списком.
    { href: '/review', label: 'Ревью документации', badgeKey: 'gapQueue' },
    { href: '/changelog', label: 'Лист внутренних изменений' },
    { href: '/architect', label: 'Архитектурный каталог' },
    { href: '/agents', label: 'Харнесс-агенты' },
    { href: '/admin', label: 'Шаблоны и пользователи' },
    { href: '/capacity', label: 'Ресурсный план' },
    { href: '/analytics', label: 'Сделки и точность' },
    { href: '/leaderboard', label: 'Рейтинг команды' },
  ],
};

export function navItemsFor(role: string | null | undefined): NavItem[] {
  return isAppRole(role) ? NAV_BY_ROLE[role] : [];
}
