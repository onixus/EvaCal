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

/** Роли, работающие с очередью нормоконтроля (первый этап). Админ ведёт оба этапа. */
export function isTechWriterRole(role: string | null | undefined): boolean {
  return role === 'techwriter' || role === 'reviewer' || role === 'admin';
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
  return role === 'admin' ? 'gap' : isTechWriterRole(role) ? 'tw' : 'gap';
}

/** Этапы ревью, очереди которых роль видит на экране `/review`. */
export function reviewStagesFor(role: string | null | undefined): ('tw' | 'gap')[] {
  if (role === 'admin') return ['tw', 'gap'];
  return [defaultReviewStageFor(role)];
}

/**
 * Экран после входа. Все роли попадают на рабочий стол: он показывает очередь
 * именно этой роли и конвейер проектов, поэтому отдельные посадочные страницы
 * больше не нужны.
 */
export const ROLE_HOME: Record<AppRole, string> = {
  presale: '/',
  architect: '/',
  techwriter: '/',
  gap: '/',
  reviewer: '/',
  admin: '/',
};

export type NavGroup = 'work' | 'docs' | 'analytics' | 'admin';

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  work: 'Работа',
  docs: 'Документация',
  analytics: 'Аналитика',
  admin: 'Администрирование',
};

export const NAV_GROUP_ORDER: NavGroup[] = ['work', 'docs', 'analytics', 'admin'];

export interface NavItem {
  href: string;
  label: string;
  group: NavGroup;
  /** Ключ счётчика из `/api/nav/badges`; пункт без ключа бейдж не показывает. */
  badgeKey?: 'studioDrafts' | 'reviewQueue' | 'gapQueue';
}

const DASHBOARD: NavItem = { href: '/', label: 'Рабочий стол', group: 'work' };
const PROJECTS: NavItem = { href: '/projects', label: 'Проекты', group: 'work' };
const CALCULATIONS: NavItem = { href: '/calculations', label: 'Расчёты и сметы', group: 'work' };
const PRESALE: NavItem = { href: '/presale', label: 'Пресейл-мастер', group: 'work' };
const STUDIO: NavItem = {
  href: '/studio',
  label: 'Студия ГОСТ 34',
  group: 'work',
  badgeKey: 'studioDrafts',
};
const CHANGELOG: NavItem = {
  href: '/changelog',
  label: 'Лист внутренних изменений',
  group: 'docs',
};
const STANDARDS: NavItem = { href: '/standards', label: 'Чек-листы и стандарты', group: 'docs' };
const CATALOG: NavItem = { href: '/architect', label: 'Архитектурный каталог', group: 'docs' };
const CAPACITY: NavItem = { href: '/capacity', label: 'Ресурсный план', group: 'analytics' };
const ANALYTICS: NavItem = { href: '/analytics', label: 'Сделки и точность', group: 'analytics' };
const LEADERBOARD: NavItem = { href: '/leaderboard', label: 'Рейтинг команды', group: 'analytics' };
const AGENTS: NavItem = { href: '/agents', label: 'Харнесс-агенты', group: 'admin' };
const ADMIN: NavItem = { href: '/admin', label: 'Шаблоны и пользователи', group: 'admin' };

/**
 * Навигация зависит от роли: у каждой свой набор экранов. Пункты сгруппированы
 * по смыслу (работа → документация → аналитика → администрирование), чтобы
 * список не читался как плоская простыня из десяти ссылок. Общие пункты
 * («Рабочий стол», «Проекты») повторяются намеренно — это входная точка
 * и для пресейла, и для архитектора.
 */
export const NAV_BY_ROLE: Record<AppRole, NavItem[]> = {
  presale: [DASHBOARD, PROJECTS, PRESALE, CALCULATIONS, ANALYTICS, LEADERBOARD],
  architect: [
    DASHBOARD,
    PROJECTS,
    CALCULATIONS,
    STUDIO,
    // Архитектор выпускает комплект, но подпись ставит ГАП: пункт ведёт на ту
    // же очередь как наблюдательный — видно, где стоят его выпуски.
    { href: '/review', label: 'Комплекты на подписи', group: 'work', badgeKey: 'gapQueue' },
    CHANGELOG,
    CATALOG,
    CAPACITY,
    ANALYTICS,
    LEADERBOARD,
    AGENTS,
  ],
  techwriter: [
    DASHBOARD,
    { href: '/review', label: 'Очередь нормоконтроля', group: 'work', badgeKey: 'reviewQueue' },
    CHANGELOG,
    STANDARDS,
    CAPACITY,
    ANALYTICS,
    LEADERBOARD,
  ],
  gap: [
    DASHBOARD,
    { href: '/review', label: 'Финальное ревью (ГАП)', group: 'work', badgeKey: 'gapQueue' },
    PROJECTS,
    CALCULATIONS,
    CHANGELOG,
    STANDARDS,
    CAPACITY,
    ANALYTICS,
    LEADERBOARD,
  ],
  reviewer: [
    DASHBOARD,
    { href: '/review', label: 'Очередь ревью', group: 'work', badgeKey: 'reviewQueue' },
    CHANGELOG,
    STANDARDS,
    CAPACITY,
    ANALYTICS,
    LEADERBOARD,
  ],
  // Администратор — надмножество всех ролей: видит все экраны и обе очереди ревью.
  admin: [
    DASHBOARD,
    PROJECTS,
    PRESALE,
    CALCULATIONS,
    STUDIO,
    { href: '/review', label: 'Ревью документации', group: 'work', badgeKey: 'reviewQueue' },
    CHANGELOG,
    STANDARDS,
    CATALOG,
    CAPACITY,
    ANALYTICS,
    LEADERBOARD,
    ADMIN,
    AGENTS,
  ],
};

export function navItemsFor(role: string | null | undefined): NavItem[] {
  return isAppRole(role) ? NAV_BY_ROLE[role] : [];
}

/** Пункты, сгруппированные для сайдбара; пустые группы не возвращаются. */
export function navGroupsFor(
  role: string | null | undefined,
): { group: NavGroup; label: string; items: NavItem[] }[] {
  const items = navItemsFor(role);
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    items: items.filter((item) => item.group === group),
  })).filter((g) => g.items.length > 0);
}

/** Кто может завести новый расчёт (кнопка в шапке и на рабочем столе). */
export function canCreateCalculation(role: string | null | undefined): boolean {
  return role === 'presale' || hasArchitectPowers(role);
}

/** Кто видит реестр проектов. Пресейл заводит проекты и версии смет, ГАП читает. */
export const PROJECT_VIEWER_ROLES: AppRole[] = ['presale', 'architect', 'gap', 'admin'];
