/**
 * Правила проверок приёмки (#103 WP-4a).
 *
 * Чистые функции без доступа к БД: их используют маршруты, экран испытаний и
 * интеграционная проверка, чтобы кнопка в UI и отказ сервера опирались на
 * одно правило.
 *
 * Главные инварианты:
 *  - проверка привязана к требованию конкретной утверждённой редакции
 *    комплекта (а не к расчёту или проекту вообще);
 *  - текущее состояние — последний записанный результат; без результатов
 *    проверка «не проводилась». Состояние «пройдена» по умолчанию не
 *    назначается никогда;
 *  - «пройдена» и «не пройдена» требуют исполнителя, даты и фактического
 *    результата (то же ограничение продублировано CHECK в БД);
 *  - повторная проверка — новый результат, старые не меняются.
 */
import { hasArchitectPowers } from '@/lib/appRoles';
import type { VerificationMethod } from '@/lib/gost34/requirements/v2';

export type AcceptanceStatus = 'not_run' | 'passed' | 'failed' | 'blocked';
export type RemarkStatus = 'open' | 'resolved' | 'verified';
export type RemarkAction = 'resolve' | 'reopen' | 'verify';

export const ACCEPTANCE_STATUSES: AcceptanceStatus[] = ['not_run', 'passed', 'failed', 'blocked'];
export const REMARK_STATUSES: RemarkStatus[] = ['open', 'resolved', 'verified'];
export const REMARK_ACTIONS: RemarkAction[] = ['resolve', 'reopen', 'verify'];
export const VERIFICATION_METHODS: VerificationMethod[] = [
  'INSPECTION',
  'ANALYSIS',
  'DEMONSTRATION',
  'TEST',
];

export const ACCEPTANCE_STATUS_LABELS: Record<AcceptanceStatus, string> = {
  not_run: 'Не проводилась',
  passed: 'Пройдена',
  failed: 'Не пройдена',
  blocked: 'Заблокирована',
};

export const REMARK_STATUS_LABELS: Record<RemarkStatus, string> = {
  open: 'Открыто',
  resolved: 'Устранено',
  verified: 'Проверено',
};

export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  INSPECTION: 'Осмотр',
  ANALYSIS: 'Анализ',
  DEMONSTRATION: 'Демонстрация',
  TEST: 'Испытание',
};

export function isAcceptanceStatus(value: unknown): value is AcceptanceStatus {
  return typeof value === 'string' && (ACCEPTANCE_STATUSES as string[]).includes(value);
}

export function isRemarkAction(value: unknown): value is RemarkAction {
  return typeof value === 'string' && (REMARK_ACTIONS as string[]).includes(value);
}

export type RuleResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; status: number; error: string };

const deny = (status: number, error: string) => ({ ok: false as const, status, error });

// ------------------------------------------------------------------ роли

/**
 * Кто проводит испытания и записывает их результаты: архитектор и админ
 * (выпускают комплект и ведут проект) и ГАП (отвечает за приёмку решения).
 * Тех.писатель и рецензент работают с текстом документов, пресейл — с
 * расчётом: результаты испытаний они только читают. Гость по share-ссылке
 * читает проверки (scope `read`), но не записывает: отдельного scope для
 * испытаний нет, а `review`/`write` дают права на другое.
 */
export function canRecordAcceptance(role: string | null | undefined): boolean {
  return role === 'gap' || hasArchitectPowers(role);
}

/** Сформировать проверки из снимка комплекта вправе те же роли. */
export const canSeedAcceptance = canRecordAcceptance;

// ------------------------------------------------------------- комплект

export interface PackageLike {
  status: string;
  reviewStage?: string | null;
}

/**
 * Проверки заводятся только для утверждённой редакции: испытания проводятся
 * по согласованной ПМИ. Выпущенная, но не утверждённая версия ещё может
 * измениться, а черновик и архив — не редакция вовсе.
 */
export function isPackageEligibleForChecks(pkg: PackageLike): boolean {
  return pkg.status === 'approved' || (pkg.reviewStage === 'done' && pkg.status !== 'archived');
}

// ------------------------------------------------------- засев из снимка

export interface CheckSeed {
  requirementId: string;
  requirementCode: string;
  title: string;
  method: VerificationMethod | null;
  criteria: string[];
  order: number;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Проверки из требований снимка комплекта. Снимок хранит требования в виде
 * legacy-строк мастера (`criterion` — одной строкой) или v2
 * (`acceptanceCriteria[]`, `verificationMethod`); поддерживаются оба.
 * Требование без критерия и без метода проверкой не становится: проверять
 * в нём нечего, и придумывать критерий за ПМИ нельзя.
 */
export function extractCheckSeeds(snapshot: unknown): CheckSeed[] {
  const reqs =
    snapshot && typeof snapshot === 'object'
      ? (snapshot as { requirements?: unknown }).requirements
      : null;
  if (!Array.isArray(reqs)) return [];
  const seeds: CheckSeed[] = [];
  const seen = new Set<string>();
  reqs.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    const requirementId = str(r.id);
    if (!requirementId || seen.has(requirementId)) return;
    const criteria = Array.isArray(r.acceptanceCriteria)
      ? r.acceptanceCriteria.map(str).filter(Boolean)
      : str(r.criterion)
        ? [str(r.criterion)]
        : [];
    const methodRaw = str(r.verificationMethod).toUpperCase();
    const method = (VERIFICATION_METHODS as string[]).includes(methodRaw)
      ? (methodRaw as VerificationMethod)
      : null;
    if (criteria.length === 0 && !method) return;
    seen.add(requirementId);
    seeds.push({
      requirementId: requirementId.slice(0, 200),
      requirementCode: (str(r.code) || requirementId).slice(0, 100),
      title: (str(r.title) || str(r.description) || str(r.originalText) || requirementId).slice(
        0,
        1000,
      ),
      method,
      criteria: criteria.map((c) => c.slice(0, 2000)),
      order: seeds.length,
    });
  });
  return seeds;
}

// ------------------------------------------------------------ результаты

export interface ResultLike {
  id: string;
  status: string;
  createdAt: Date | string;
}

const ts = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Результаты от новых к старым; при равном времени — по id (стабильно). */
export function sortResultsNewestFirst<T extends ResultLike>(results: T[]): T[] {
  return [...results].sort((a, b) => ts(b.createdAt) - ts(a.createdAt) || (a.id < b.id ? 1 : -1));
}

/** Последний записанный результат или null. */
export function latestResult<T extends ResultLike>(results: T[]): T | null {
  return sortResultsNewestFirst(results)[0] ?? null;
}

/** Текущее состояние: последний результат; нет результатов — «не проводилась». */
export function currentStatus(results: ResultLike[]): AcceptanceStatus {
  const last = latestResult(results);
  return last && isAcceptanceStatus(last.status) ? last.status : 'not_run';
}

export interface EvidenceRef {
  key: string;
  name: string;
  size: number;
  mime: string;
  checksum: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface ResultInput {
  status?: unknown;
  executorName?: unknown;
  executedAt?: unknown;
  actualResult?: unknown;
}

export interface NormalizedResult {
  status: AcceptanceStatus;
  executorName: string | null;
  executedAt: Date | null;
  actualResult: string | null;
}

/** Допуск на расхождение часов клиента и сервера для даты проведения. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Проверка записываемого результата.
 *  - `passed`/`failed` — исполнитель, дата проведения и фактический результат
 *    обязательны;
 *  - `blocked` — обязательна причина блокировки (в `actualResult`);
 *  - `not_run` — явный сброс (например, после изменения стенда); комментарий
 *    по желанию.
 * Дата проведения не может быть в будущем.
 */
export function validateResultInput(
  input: ResultInput,
  now: Date = new Date(),
): RuleResult<NormalizedResult> {
  if (!isAcceptanceStatus(input.status)) {
    return deny(400, 'Укажите состояние: not_run, passed, failed или blocked');
  }
  const status = input.status;
  const executorName = str(input.executorName).slice(0, 200) || null;
  const actualResult = str(input.actualResult).slice(0, 10000) || null;
  let executedAt: Date | null = null;
  if (input.executedAt !== undefined && input.executedAt !== null && input.executedAt !== '') {
    const parsed = new Date(String(input.executedAt));
    if (Number.isNaN(parsed.getTime())) return deny(400, 'Некорректная дата проведения');
    if (parsed.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      return deny(400, 'Дата проведения не может быть в будущем');
    }
    executedAt = parsed;
  }
  if (status === 'passed' || status === 'failed') {
    if (!executorName) return deny(400, 'Укажите исполнителя проверки');
    if (!executedAt) return deny(400, 'Укажите дату проведения проверки');
    if (!actualResult) return deny(400, 'Опишите фактический результат проверки');
  }
  if (status === 'blocked' && !actualResult) {
    return deny(400, 'Укажите причину блокировки проверки');
  }
  return { ok: true, value: { status, executorName, executedAt, actualResult } };
}

// ------------------------------------------------------------ замечания

export interface RemarkLike {
  status: string;
  createdAt: Date | string;
}

/**
 * Жизненный цикл замечания: открыто → устранено → проверено.
 *  - `resolve`: open → resolved (исправление выполнено, ждёт повторной проверки);
 *  - `reopen`: resolved → open (исправление не подтвердилось);
 *  - `verify`: resolved → verified, только со ссылкой на повторную проверку той
 *    же проверки — результат `passed`, записанный позже замечания.
 * Проверенное замечание закрыто окончательно: новое расхождение — новое замечание.
 */
export function checkRemarkTransition(
  remark: RemarkLike,
  action: RemarkAction,
  retest?: (ResultLike & { checkId: string }) | null,
  checkId?: string,
): RuleResult<RemarkStatus> {
  if (action === 'resolve') {
    if (remark.status !== 'open') return deny(409, 'Устранить можно только открытое замечание');
    return { ok: true, value: 'resolved' };
  }
  if (action === 'reopen') {
    if (remark.status !== 'resolved') {
      return deny(409, 'Вернуть в работу можно только устранённое замечание');
    }
    return { ok: true, value: 'open' };
  }
  if (remark.status !== 'resolved') {
    return deny(409, 'Проверить можно только устранённое замечание');
  }
  if (!retest) return deny(400, 'Укажите повторную проверку, подтверждающую устранение');
  if (checkId && retest.checkId !== checkId) {
    return deny(400, 'Повторная проверка относится к другой проверке');
  }
  if (retest.status !== 'passed') {
    return deny(409, 'Замечание снимается только пройденной повторной проверкой');
  }
  if (ts(retest.createdAt) < ts(remark.createdAt)) {
    return deny(409, 'Повторная проверка должна быть записана после замечания');
  }
  return { ok: true, value: 'verified' };
}

// ---------------------------------------------------------------- сводка

export interface AcceptanceSummary {
  total: number;
  byStatus: Record<AcceptanceStatus, number>;
  openRemarks: number;
}

export function summarizeChecks(
  checks: { status: AcceptanceStatus; openRemarks: number }[],
): AcceptanceSummary {
  const byStatus: Record<AcceptanceStatus, number> = {
    not_run: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
  };
  let openRemarks = 0;
  for (const c of checks) {
    byStatus[c.status] += 1;
    openRemarks += c.openRemarks;
  }
  return { total: checks.length, byStatus, openRemarks };
}

// -------------------------------------------------------------- вложения

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MAX_FILES = 10;

/** Разрешённые расширения вложений и их MIME. */
export const EVIDENCE_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  txt: ['text/plain'],
  log: ['text/plain'],
  csv: ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  json: ['application/json', 'text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  zip: ['application/zip', 'application/x-zip-compressed'],
};

/**
 * Тип вложения проверяется и по расширению, и по MIME: браузер может не
 * поставить MIME (тогда решает расширение), но несовпадающий MIME — отказ.
 */
export function validateEvidenceFile(file: {
  name: string;
  size: number;
  type: string;
}): RuleResult<{ ext: string; mime: string }> {
  if (file.size <= 0) return deny(400, 'Файл пустой');
  if (file.size > EVIDENCE_MAX_BYTES) return deny(413, 'Файл больше 10 МБ');
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const allowed = EVIDENCE_TYPES[ext];
  if (!allowed || !file.name.includes('.')) {
    return deny(
      415,
      `Недопустимый тип файла. Разрешены: ${Object.keys(EVIDENCE_TYPES).join(', ')}`,
    );
  }
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  if (mime && mime !== 'application/octet-stream' && !allowed.includes(mime)) {
    return deny(415, 'Тип содержимого не совпадает с расширением файла');
  }
  return { ok: true, value: { ext, mime: allowed[0] } };
}

/** Префикс ключей вложений одной проверки в хранилище комплектов. */
export function evidenceKeyPrefix(packageId: string, checkId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `acceptance/${safe(packageId)}/${safe(checkId)}/`;
}

/**
 * Ссылки на вложения из запроса. Принимаются только ключи этой проверки
 * (префикс) без обходов пути; существование файлов проверяет хранилище.
 */
export function parseEvidenceRefs(
  raw: unknown,
  packageId: string,
  checkId: string,
): RuleResult<EvidenceRef[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return deny(400, 'Вложения передаются списком');
  if (raw.length > EVIDENCE_MAX_FILES) {
    return deny(400, `Не больше ${EVIDENCE_MAX_FILES} вложений на результат`);
  }
  const prefix = evidenceKeyPrefix(packageId, checkId);
  const refs: EvidenceRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return deny(400, 'Некорректное вложение');
    const r = item as Record<string, unknown>;
    const key = str(r.key);
    if (!key.startsWith(prefix) || key.includes('..') || key.slice(prefix.length).includes('/')) {
      return deny(400, 'Вложение не относится к этой проверке');
    }
    refs.push({
      key,
      name: str(r.name).slice(0, 255) || key.slice(prefix.length),
      size: Number(r.size) || 0,
      mime: str(r.mime).slice(0, 100),
      checksum: str(r.checksum).slice(0, 64),
      uploadedAt: str(r.uploadedAt),
      uploadedBy: str(r.uploadedBy).slice(0, 200),
    });
  }
  if (new Set(refs.map((r) => r.key)).size !== refs.length) {
    return deny(400, 'Вложение указано дважды');
  }
  return { ok: true, value: refs };
}
