/**
 * Двухэтапное ревью комплекта ГОСТ 34.
 *
 * Этап 1 — нормоконтроль тех.писателя: чек-лист оформления, комментарии по
 * разделам и, при необходимости, своя правленая версия DOCX. Этап 2 — финальное
 * ревью ГАП, который видит итоги первого этапа и утверждает выпуск.
 *
 * Разделение введено потому, что раньше «ревью» было одним экраном с двумя
 * кнопками: замечания по оформлению и решение о выпуске смешивались, и никакого
 * следа нормоконтроля в реестре не оставалось.
 */

export type ReviewStage = 'tw' | 'gap' | 'done';

export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = {
  tw: 'Ревью тех.писателя',
  gap: 'Финальное ревью — ГАП',
  done: 'Ревью завершено',
};

/**
 * Кто выносит решение на каждом этапе.
 *
 * Разделение ответственности держалось только на фильтрах экрана `/review`:
 * маршрут проверял лишь право `review`, которое есть и у ревьювера, и у
 * архитектора, поэтому тех.писатель мог сам же поставить подпись ГАПа, а
 * архитектор — пройти за него нормоконтроль. Этап решает, чья это подпись.
 *
 * Обе подписи закреплены за собственными ролями: нормоконтроль подписывает
 * `techwriter`, выпуск — `gap`. Архитектор выпускает комплект и потому своей
 * подписи под ним не ставит; рецензент (`reviewer`) ведёт замечания, но
 * вердикта не выносит. Админ ведёт оба этапа: иначе застрявший комплект
 * некому разблокировать.
 */
export const REVIEW_STAGE_ROLES: Record<Exclude<ReviewStage, 'done'>, string[]> = {
  tw: ['techwriter', 'admin'],
  gap: ['gap', 'admin'],
};

/** Вправе ли роль вынести решение на этапе, где сейчас стоит комплект. */
export function canDecideReviewStage(role: string | null | undefined, stage: ReviewStage): boolean {
  if (stage === 'done') return false;
  return REVIEW_STAGE_ROLES[stage].includes(role ?? '');
}

/**
 * Этапы, доступные гостю по share-ссылке со scope `review`.
 *
 * Оба: разделение подписей — правило для сотрудников, а гость по ссылке это
 * внешний согласующий со стороны Заказчика. По ГОСТ 34.602 техническое задание
 * утверждает именно Заказчик — на титульном листе стоит его «УТВЕРЖДАЮ», — и
 * портал согласования держится на этой ссылке. Запрет гостю на финальный этап
 * убрал бы утверждение Заказчиком вовсе.
 */
export const SHARE_ALLOWED_STAGES: ReviewStage[] = ['tw', 'gap'];

/** Состояние пункта чек-листа нормоконтроля. */
export type ChecklistState = 'ok' | 'block' | 'warn' | 'empty';

export interface ChecklistItem {
  id: string;
  title: string;
  /** Как проверяется: автоматикой генератора или глазами. */
  kind: 'auto' | 'manual';
  state: ChecklistState;
  /** Пояснение под заголовком: что именно нашли или где смотреть. */
  note: string;
}

/** Серьёзность комментария к разделу. */
export type CommentSeverity = 'blocker' | 'remark' | 'suggestion';

export const COMMENT_SEVERITY_LABELS: Record<CommentSeverity, string> = {
  blocker: 'блокер',
  remark: 'замечание',
  suggestion: 'предложение',
};

/**
 * Жизненный цикл замечания: открыто → исправлено (в более новой версии
 * комплекта) → проверено. «Отклонено» — замечание снято автором или ролью
 * этапа как неприменимое. Закрытыми считаются только «проверено» и
 * «отклонено»: исправление без проверки замечание не закрывает.
 */
export type CommentStatus = 'open' | 'fixed' | 'verified' | 'rejected';

export const COMMENT_STATUS_LABELS: Record<CommentStatus, string> = {
  open: 'открыто',
  fixed: 'исправлено',
  verified: 'проверено',
  rejected: 'отклонено',
};

export interface CommentReply {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface SectionComment {
  id: string;
  sectionId: string;
  severity: CommentSeverity;
  text: string;
  author: string;
  createdAt: string;
  /** Нет у замечаний из старого JSON-столбца — такие считаются открытыми. */
  status?: CommentStatus;
  /** Этап, на котором оставлено замечание: его роль вправе его проверить. */
  stage?: 'tw' | 'gap';
  authorId?: string | null;
  /** Комплект и версия, к которым замечание оставлено. */
  packageId?: string;
  packageVersion?: number;
  fixedBy?: string | null;
  fixedAt?: string | null;
  fixedInPackageId?: string | null;
  fixedInVersion?: number | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  replies?: CommentReply[];
  /** Прочитано из резервного JSON-столбца: действия над ним недоступны. */
  legacy?: boolean;
}

/** Замечание закрыто: проверено после исправления или отклонено. */
export function isCommentResolved(comment: Pick<SectionComment, 'status'>): boolean {
  return comment.status === 'verified' || comment.status === 'rejected';
}

/**
 * Базовый чек-лист нормоконтроля. Автопункты заполняет генератор при выпуске,
 * ручные ревьювер отмечает сам — поэтому они приходят в состоянии `empty`, а
 * не «пройдено по умолчанию»: непроверенный пункт не должен выглядеть закрытым.
 */
export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  {
    id: 'page-numbers',
    title: 'Номер страницы сверху по центру, титульный не нумеруется',
    kind: 'auto',
    state: 'empty',
    note: 'автопроверка · оформление профиля',
  },
  {
    id: 'section-page-break',
    title: 'Разделы 1-го уровня начинаются с новой страницы',
    kind: 'auto',
    state: 'empty',
    note: 'автопроверка · нормоконтроль',
  },
  {
    id: 'table-captions',
    title: 'Таблицы: «Т а б л и ц а N — Наименование», шапка повторяется',
    kind: 'auto',
    state: 'empty',
    note: 'автопроверка · нормоконтроль',
  },
  {
    id: 'requirement-modality',
    title: 'Формулировки требований с глаголом долженствования',
    kind: 'auto',
    state: 'empty',
    note: 'автопроверка · валидатор ГОСТ 34.602',
  },
  {
    id: 'terminology',
    title: 'Терминология едина по всему комплекту',
    kind: 'manual',
    state: 'empty',
    note: 'проверить вручную по тексту разделов',
  },
  {
    id: 'standard-refs',
    title: 'Ссылки на стандарты не разорваны переносом',
    kind: 'manual',
    state: 'empty',
    note: 'проверить вручную в PDF-выгрузке',
  },
];

export function parseChecklist(raw: string | null | undefined): ChecklistItem[] {
  if (!raw) return DEFAULT_CHECKLIST;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CHECKLIST;

    // Сохранённый чек-лист мог быть записан старой версией без части пунктов.
    // База — актуальный список, поверх накладываются сохранённые состояния:
    // иначе новый пункт нормоконтроля не появился бы у уже открытых комплектов.
    return DEFAULT_CHECKLIST.map((item) => {
      const saved = parsed.find((p: ChecklistItem) => p?.id === item.id);
      return saved
        ? { ...item, state: saved.state ?? item.state, note: saved.note ?? item.note }
        : item;
    });
  } catch {
    return DEFAULT_CHECKLIST;
  }
}

export function parseComments(raw: string | null | undefined): SectionComment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SectionComment[]) : [];
  } catch {
    return [];
  }
}

/** Счётчики незакрытых замечаний для карточки вердикта. */
export function countBySeverity(comments: SectionComment[]) {
  const unresolved = comments.filter((c) => !isCommentResolved(c));
  return {
    blocker: unresolved.filter((c) => c.severity === 'blocker').length,
    remark: unresolved.filter((c) => c.severity === 'remark').length,
    suggestion: unresolved.filter((c) => c.severity === 'suggestion').length,
  };
}

/**
 * Открытые блокеры: незакрытые комментарии серьёзности «блокер» плюс
 * проваленные пункты чек-листа. Утверждение при них недоступно на обоих
 * этапах — это и есть смысл нормоконтроля. Блокер, отмеченный исправленным,
 * но ещё не проверенный, по-прежнему блокирует.
 */
export function openBlockerCount(comments: SectionComment[], checklist: ChecklistItem[]): number {
  return (
    comments.filter((c) => c.severity === 'blocker' && !isCommentResolved(c)).length +
    checklist.filter((c) => c.state === 'block').length
  );
}
