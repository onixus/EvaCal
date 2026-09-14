/**
 * Рейтинг эффективности пресейлов и архитекторов.
 *
 * Чистая агрегация: сюда приходят уже выбранные строки из БД, отсюда уходят
 * готовые к рендеру карточки. Логику оценки держим в одном месте, чтобы
 * страница `/leaderboard` и `GET /api/leaderboard` показывали одно и то же.
 *
 * Дашборд открытый (без входа), поэтому наружу идут только имена сотрудников
 * и агрегаты — ни названий расчётов, ни заказчиков, ни сумм смет.
 */

export type LeaderboardPeriod = '30' | '90' | '365' | 'all';

export const LEADERBOARD_PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '365', label: 'Год' },
  { value: 'all', label: 'За всё время' },
];

export function parsePeriod(raw: string | undefined | null): LeaderboardPeriod {
  return LEADERBOARD_PERIODS.some((p) => p.value === raw) ? (raw as LeaderboardPeriod) : 'all';
}

/** Нижняя граница периода; `null` — без ограничения. */
export function periodSince(period: LeaderboardPeriod, now: Date = new Date()): Date | null {
  if (period === 'all') return null;
  const days = Number(period);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Входные строки
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  role: string;
}

export interface CalculationRow {
  createdBy: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PackageRow {
  createdBy: string;
  releasedBy: string | null;
  approvedBy: string | null;
  status: string;
  releasedAt: Date | null;
  approvedAt: Date | null;
}

/** Событие аудита `calculation.approve`: кто согласовал расчёт пресейла. */
export interface ApprovalEventRow {
  actorId: string | null;
}

// ---------------------------------------------------------------------------
// Результат
// ---------------------------------------------------------------------------

export interface PresaleEntry {
  name: string;
  role: string;
  total: number;
  approved: number;
  pending: number;
  draft: number;
  /** Доля утверждённых расчётов от всех созданных, 0..1. */
  conversion: number;
  /** Доля расчётов, потребовавших новой версии (переделка), 0..1. */
  reworkRate: number;
  /** Медиана дней от создания до утверждения; null — утверждённых нет. */
  medianCycleDays: number | null;
  /** Интегральная оценка 0..100. */
  score: number;
  /** Меньше MIN_SAMPLE расчётов — оценка ненадёжна. */
  lowSample: boolean;
}

export interface ArchitectEntry {
  name: string;
  role: string;
  /** Согласованных расчётов пресейла (по журналу аудита). */
  calcApproved: number;
  /** Выпущенных комплектов ГОСТ 34. */
  released: number;
  /** Решений в роли ГАП (утверждённые комплекты). */
  gapApproved: number;
  /** Своих комплектов, прошедших ревью с первого раза / возвращённых. */
  authoredApproved: number;
  authoredRejected: number;
  /** Доля своих комплектов, принятых без возврата; null — решений ещё нет. */
  firstPassRate: number | null;
  /** Медиана дней от выпуска до утверждения своих комплектов. */
  medianTurnaroundDays: number | null;
  score: number;
  lowSample: boolean;
}

export interface Leaderboard {
  period: LeaderboardPeriod;
  generatedAt: string;
  presale: RankedBoard<PresaleEntry>;
  architects: RankedBoard<ArchitectEntry>;
}

export interface RankedBoard<T> {
  /** Все участники, отсортированы по убыванию оценки. */
  all: T[];
  top: T[];
  bottom: T[];
}

/** Ниже этого числа действий оценка помечается как ненадёжная. */
export const MIN_SAMPLE = 3;
/** Сколько строк показывать в блоках «лучшие» и «отстающие». */
export const BOARD_SIZE = 3;

/** Легаси-авторы: расчёт создан без учётки — по ссылке или анонимно. */
const LEGACY_PRESALE_AUTHORS: Record<string, string> = {
  'presale-share': 'Гость по share-ссылке',
  anonymous: 'Анонимный пресейл',
};

// ---------------------------------------------------------------------------
// Вспомогательные
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Приводит значение из `createdBy` / `releasedBy` / `actorId` к человеку.
 * В разных роутах туда попадает то логин, то id пользователя — разрешаем оба.
 */
function resolveActor(
  raw: string | null | undefined,
  users: UserRow[],
): { name: string; role: string } | null {
  if (!raw) return null;
  const byId = users.find((u) => u.id === raw);
  if (byId) return { name: byId.username, role: byId.role };
  const byName = users.find((u) => u.username === raw);
  if (byName) return { name: byName.username, role: byName.role };
  if (raw in LEGACY_PRESALE_AUTHORS) return { name: LEGACY_PRESALE_AUTHORS[raw], role: 'guest' };
  return { name: raw, role: 'unknown' };
}

/**
 * Делит участников на «лучших» и «отстающих». При малой команде (до двух
 * досок) список режется пополам, чтобы обе части были заполнены; дальше —
 * по BOARD_SIZE с каждого конца. Один человек попадает только в одну доску.
 */
function rank<T extends { score: number; name: string }>(entries: T[]): RankedBoard<T> {
  const all = [...entries].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
  if (all.length < 2) return { all, top: all, bottom: [] };
  const topSize = all.length <= BOARD_SIZE * 2 ? Math.ceil(all.length / 2) : BOARD_SIZE;
  const bottomSize = all.length <= BOARD_SIZE * 2 ? all.length - topSize : BOARD_SIZE;
  const top = all.slice(0, topSize);
  const bottom = all.slice(all.length - bottomSize).reverse();
  return { all, top, bottom };
}

// ---------------------------------------------------------------------------
// Пресейл
// ---------------------------------------------------------------------------

/**
 * Оценка пресейла: 70 % — конверсия расчётов в утверждённые, 20 % — отсутствие
 * переделок, 10 % — объём относительно самого активного коллеги.
 */
export function buildPresaleBoard(
  calculations: CalculationRow[],
  users: UserRow[],
): RankedBoard<PresaleEntry> {
  const groups = new Map<string, { role: string; rows: CalculationRow[] }>();
  for (const row of calculations) {
    const actor = resolveActor(row.createdBy, users);
    if (!actor) continue;
    const group = groups.get(actor.name) ?? { role: actor.role, rows: [] };
    group.rows.push(row);
    groups.set(actor.name, group);
  }

  const maxTotal = Math.max(1, ...[...groups.values()].map((g) => g.rows.length));

  const entries: PresaleEntry[] = [...groups.entries()].map(([name, group]) => {
    const total = group.rows.length;
    const approvedRows = group.rows.filter((r) => r.status === 'approved');
    const approved = approvedRows.length;
    const pending = group.rows.filter((r) => r.status === 'pending_approval').length;
    const draft = group.rows.filter((r) => r.status === 'draft').length;
    const rework = group.rows.filter((r) => r.version > 1).length;

    const conversion = total ? approved / total : 0;
    const reworkRate = total ? rework / total : 0;
    const cycle = median(approvedRows.map((r) => daysBetween(r.createdAt, r.updatedAt)));
    const volume = total / maxTotal;

    const score = Math.round(100 * (0.7 * conversion + 0.2 * (1 - reworkRate) + 0.1 * volume));

    return {
      name,
      role: group.role,
      total,
      approved,
      pending,
      draft,
      conversion: round1(conversion * 100) / 100,
      reworkRate: round1(reworkRate * 100) / 100,
      medianCycleDays: cycle === null ? null : round1(cycle),
      score,
      lowSample: total < MIN_SAMPLE,
    };
  });

  return rank(entries);
}

// ---------------------------------------------------------------------------
// Архитекторы
// ---------------------------------------------------------------------------

/**
 * Оценка архитектора: 50 % — доля своих комплектов, принятых ревью без
 * возврата, 30 % — пропускная способность (согласования + выпуски + решения
 * ГАП) относительно самого продуктивного коллеги, 20 % — скорость прохождения
 * ревью своими комплектами. Без решённых комплектов приёмка считается 50 %.
 */
export function buildArchitectBoard(
  packages: PackageRow[],
  approvals: ApprovalEventRow[],
  users: UserRow[],
): RankedBoard<ArchitectEntry> {
  interface Acc {
    role: string;
    calcApproved: number;
    released: number;
    gapApproved: number;
    authoredApproved: number;
    authoredRejected: number;
    turnarounds: number[];
  }
  const groups = new Map<string, Acc>();
  const get = (raw: string | null | undefined): Acc | null => {
    const actor = resolveActor(raw, users);
    if (!actor) return null;
    let acc = groups.get(actor.name);
    if (!acc) {
      acc = {
        role: actor.role,
        calcApproved: 0,
        released: 0,
        gapApproved: 0,
        authoredApproved: 0,
        authoredRejected: 0,
        turnarounds: [],
      };
      groups.set(actor.name, acc);
    }
    return acc;
  };

  for (const ev of approvals) {
    const acc = get(ev.actorId);
    if (acc) acc.calcApproved += 1;
  }

  for (const pkg of packages) {
    const releaser = get(pkg.releasedBy ?? pkg.createdBy);
    if (releaser) releaser.released += 1;

    const author = get(pkg.createdBy);
    if (author) {
      if (pkg.status === 'approved') {
        author.authoredApproved += 1;
        if (pkg.releasedAt && pkg.approvedAt) {
          author.turnarounds.push(daysBetween(pkg.releasedAt, pkg.approvedAt));
        }
      } else if (pkg.status === 'rejected') {
        author.authoredRejected += 1;
      }
    }

    if (pkg.status === 'approved') {
      const approver = get(pkg.approvedBy);
      if (approver) approver.gapApproved += 1;
    }
  }

  const throughput = (a: Acc) => a.calcApproved + a.released + a.gapApproved;
  const maxThroughput = Math.max(1, ...[...groups.values()].map(throughput));
  const medians = [...groups.values()]
    .map((a) => median(a.turnarounds))
    .filter((m): m is number => m !== null);
  const maxTurnaround = Math.max(1, ...medians);

  const entries: ArchitectEntry[] = [...groups.entries()].map(([name, acc]) => {
    const decided = acc.authoredApproved + acc.authoredRejected;
    const firstPassRate = decided ? acc.authoredApproved / decided : null;
    const turnaround = median(acc.turnarounds);

    const acceptance = firstPassRate ?? 0.5;
    const volume = throughput(acc) / maxThroughput;
    // Нет данных о скорости — нейтральные 0.5, чтобы не штрафовать новичка.
    const speed = turnaround === null ? 0.5 : 1 - turnaround / maxTurnaround;

    const score = Math.round(100 * (0.5 * acceptance + 0.3 * volume + 0.2 * speed));

    return {
      name,
      role: acc.role,
      calcApproved: acc.calcApproved,
      released: acc.released,
      gapApproved: acc.gapApproved,
      authoredApproved: acc.authoredApproved,
      authoredRejected: acc.authoredRejected,
      firstPassRate: firstPassRate === null ? null : round1(firstPassRate * 100) / 100,
      medianTurnaroundDays: turnaround === null ? null : round1(turnaround),
      score,
      lowSample: throughput(acc) < MIN_SAMPLE,
    };
  });

  return rank(entries);
}

export function buildLeaderboard(input: {
  period: LeaderboardPeriod;
  users: UserRow[];
  calculations: CalculationRow[];
  packages: PackageRow[];
  approvals: ApprovalEventRow[];
  now?: Date;
}): Leaderboard {
  return {
    period: input.period,
    generatedAt: (input.now ?? new Date()).toISOString(),
    presale: buildPresaleBoard(input.calculations, input.users),
    architects: buildArchitectBoard(input.packages, input.approvals, input.users),
  };
}
