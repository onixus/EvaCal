'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import PageHeader from '@/components/PageHeader';
import { stageChipClass } from '@/components/lifecycle/StageChip';
import { hasArchitectPowers } from '@/lib/appRoles';
import { daysSince, formatDays, freshnessFor, type LifecycleStageId } from '@/lib/lifecycle';
import { canDecideReviewStage, type ReviewStage } from '@/lib/gost34/review/types';

export interface BoardCard {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewStage: ReviewStage;
  reviewComment: string | null;
  openBlockers: number;
  calculationId: string;
  project: { id: string | null; name: string; code: string | null };
  customer: string;
  author: string;
  approvedBy: string | null;
  enteredAt: string;
}

export interface EstimateCard {
  id: string;
  name: string;
  customer: string;
  version: number;
  status: string;
  author: string;
  template: string;
  totalHours: number;
  project: { id: string; code: string | null } | null;
  enteredAt: string;
}

type PackageColumnId = 'draft' | 'tw' | 'gap' | 'rejected' | 'approved';
type EstimateColumnId = 'est_draft' | 'est_pending' | 'est_approved';

/**
 * Колонка доски. Пороги «висит» не задаются здесь: колонка ссылается на шаг
 * конвейера, и цвет чипа берётся из тех же `STAGE_THRESHOLDS`, что и в
 * реестре проектов — иначе доска и реестр показывали бы разные цвета одному
 * и тому же комплекту.
 */
interface Column<Id extends string> {
  id: Id;
  title: string;
  owner: string;
  hint: string;
  /** Шаг конвейера для порогов; null — терминальная колонка без сроков. */
  stage: LifecycleStageId | null;
}

const PACKAGE_COLUMNS: Column<PackageColumnId>[] = [
  {
    id: 'draft',
    title: 'Черновик',
    owner: 'архитектор',
    hint: 'Собирается в Студии. Выпуск переводит комплект на нормоконтроль.',
    stage: 'package',
  },
  {
    id: 'tw',
    title: 'Нормоконтроль',
    owner: 'тех.писатель',
    hint: 'Чек-лист оформления и замечания по разделам.',
    stage: 'review_tw',
  },
  {
    id: 'gap',
    title: 'Ревью ГАП',
    owner: 'ГАП',
    hint: 'Финальное решение о выпуске.',
    stage: 'review_gap',
  },
  {
    id: 'rejected',
    title: 'Возвращён',
    owner: 'архитектор',
    hint: 'Исправить замечания в Студии и выпустить заново.',
    stage: 'package',
  },
  {
    id: 'approved',
    title: 'Утверждён',
    owner: '—',
    hint: 'Выпущенные за последние 30 дней.',
    stage: null,
  },
];

const ESTIMATE_COLUMNS: Column<EstimateColumnId>[] = [
  {
    id: 'est_draft',
    title: 'Черновик сметы',
    owner: 'пресейл',
    hint: 'Пресейл заполняет опросник и отправляет смету на согласование.',
    stage: 'estimate',
  },
  {
    id: 'est_pending',
    title: 'На утверждении',
    owner: 'архитектор',
    hint: 'Архитектор проверяет этапы и трудозатраты и утверждает смету.',
    stage: 'estimate_review',
  },
  {
    id: 'est_approved',
    title: 'Смета утверждена',
    owner: 'архитектор',
    hint: 'Утверждённые за 30 дней: дальше — комплект ГОСТ 34 в Студии.',
    stage: null,
  },
];

function packageColumnOf(card: BoardCard): PackageColumnId {
  if (card.status === 'approved') return 'approved';
  if (card.status === 'rejected') return 'rejected';
  if (card.status === 'under_review') return card.reviewStage === 'gap' ? 'gap' : 'tw';
  return 'draft';
}

function estimateColumnOf(card: EstimateCard): EstimateColumnId {
  if (card.status === 'approved') return 'est_approved';
  if (card.status === 'pending_approval') return 'est_pending';
  return 'est_draft';
}

/**
 * Переход комплекта перетаскиванием — это вердикт ревью: колонка-источник
 * задаёт этап, колонка-цель — решение. Всё остальное (выпуск черновика,
 * повторный выпуск возвращённого) делается в Студии, и такие карточки не
 * перетаскиваются.
 */
function decisionFor(from: PackageColumnId, to: PackageColumnId): 'approve' | 'reject' | null {
  if (from === 'tw' && to === 'gap') return 'approve';
  if (from === 'gap' && to === 'approved') return 'approve';
  if ((from === 'tw' || from === 'gap') && to === 'rejected') return 'reject';
  return null;
}

type PendingMove =
  | { kind: 'package'; card: BoardCard; to: PackageColumnId; decision: 'approve' | 'reject' }
  | { kind: 'estimate'; card: EstimateCard };

type Dragging = { kind: 'package'; card: BoardCard } | { kind: 'estimate'; card: EstimateCard };

/** Тон чипа «N дн.» по шагу конвейера колонки. */
function toneFor(column: Column<string>, days: number): string {
  if (!column.stage) return 'chip-muted';
  return stageChipClass({
    attention: column.id === 'rejected' ? 'rejected' : 'none',
    freshness: freshnessFor(column.stage, days),
  });
}

interface LaneProps<Id extends string, Card extends { id: string; enteredAt: string }> {
  columns: Column<Id>[];
  cards: Card[];
  columnOf: (card: Card) => Id;
  /** Колонки, на которых решение за текущей ролью. */
  mine: Set<Id>;
  canDrag: (card: Card) => boolean;
  /** Допустим ли сброс перетаскиваемой сейчас карточки в колонку. */
  canDropInto: (col: Id) => boolean;
  dragging: Card | null;
  overColumn: string | null;
  onDragStart: (card: Card) => void;
  onDragEnd: () => void;
  onDragOver: (col: Id) => void;
  onDrop: (col: Id) => void;
  now: Date;
  minHeight: string;
  renderCard: (card: Card, column: Column<Id>, days: number) => ReactNode;
}

/**
 * Одна дорожка доски: колонки с заголовком, счётчиком, подсказкой в пустой
 * колонке и карточками. Дорожки смет и комплектов отличаются только
 * содержимым карточки и правилами перетаскивания — это передаётся пропсами.
 */
function Lane<Id extends string, Card extends { id: string; enteredAt: string }>({
  columns,
  cards,
  columnOf,
  mine,
  canDrag,
  canDropInto,
  dragging,
  overColumn,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  now,
  minHeight,
  renderCard,
}: LaneProps<Id, Card>) {
  const byColumn = useMemo(() => {
    const map = new Map<Id, Card[]>(columns.map((c) => [c.id, []]));
    for (const card of cards) map.get(columnOf(card))?.push(card);
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());
    }
    return map;
  }, [columns, cards, columnOf]);

  return (
    <div
      className={`grid gap-3 md:grid-cols-2 ${
        columns.length === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-5'
      }`}
    >
      {columns.map((col) => {
        const list = byColumn.get(col.id) ?? [];
        const dropTarget = Boolean(dragging) && canDropInto(col.id);
        const over = overColumn === col.id && dropTarget;
        return (
          <section
            key={col.id}
            aria-label={col.title}
            onDragOver={(e: DragEvent<HTMLElement>) => {
              // Проверка через canDropInto, а не через dropTarget из рендера:
              // первый dragover приходит раньше, чем React перерисует колонку
              // с новым состоянием перетаскивания.
              if (!canDropInto(col.id)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              onDragOver(col.id);
            }}
            onDrop={(e: DragEvent<HTMLElement>) => {
              e.preventDefault();
              onDrop(col.id);
            }}
            className={`flex ${minHeight} flex-col rounded-xl border transition-colors ${
              over
                ? 'border-brand-500 bg-brand-50/60 dark:border-nord-frost2 dark:bg-nord-frost4/20'
                : dropTarget
                  ? 'border-dashed border-brand-300 bg-brand-50/20 dark:border-nord-frost4 dark:bg-nord-3/40'
                  : mine.has(col.id)
                    ? 'border-slate-200 bg-slate-50 dark:border-nord-3 dark:bg-nord-1/50'
                    : 'border-slate-200 bg-slate-100/60 dark:border-nord-3 dark:bg-nord-0'
            }`}
          >
            <header className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-nord-4">
                  {col.title}
                  {mine.has(col.id) && (
                    <span className="chip-info" title="На этом этапе решение за вами">
                      вы
                    </span>
                  )}
                </h3>
                <p className="text-[10px] text-slate-400 dark:text-nord-muted">{col.owner}</p>
              </div>
              <span className="nums rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-nord-2 dark:text-nord-4">
                {list.length}
              </span>
            </header>

            <div className="flex-1 space-y-2 px-2 pb-2">
              {list.length === 0 ? (
                <p className="px-1 py-6 text-center text-[11px] text-slate-400 dark:text-nord-muted">
                  {col.hint}
                </p>
              ) : (
                list.map((card) => {
                  const draggable = canDrag(card);
                  return (
                    <article
                      key={card.id}
                      draggable={draggable}
                      onDragStart={(e: DragEvent<HTMLElement>) => {
                        if (!draggable) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', card.id);
                        onDragStart(card);
                      }}
                      onDragEnd={onDragEnd}
                      className={`card space-y-1.5 p-3 ${
                        draggable ? 'cursor-grab active:cursor-grabbing' : ''
                      } ${dragging?.id === card.id ? 'opacity-40' : ''}`}
                    >
                      {renderCard(card, col, daysSince(new Date(card.enteredAt), now))}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CardTitle({ href, name, version }: { href: string; name: string; version: number }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <Link
        href={href}
        className="min-w-0 truncate text-xs font-bold text-slate-900 hover:text-brand-700 dark:text-nord-6 dark:hover:text-nord-frost2"
        title={name}
      >
        {name}
      </Link>
      <span className="nums shrink-0 text-[10px] font-semibold text-slate-400 dark:text-nord-muted">
        v{version}
      </span>
    </div>
  );
}

function ProjectCode({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <span className="mr-1 font-mono font-bold text-brand-600 dark:text-nord-frost3">{code}</span>
  );
}

export default function BoardClient({
  cards,
  estimates,
  role,
  username,
}: {
  cards: BoardCard[];
  estimates: EstimateCard[];
  role: string;
  username: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [dragging, setDraggingState] = useState<Dragging | null>(null);
  // Ref дублирует состояние для обработчиков drag-событий, которые срабатывают
  // до перерисовки и видели бы устаревшее замыкание.
  const draggingRef = useRef<Dragging | null>(null);
  const setDragging = (next: Dragging | null) => {
    draggingRef.current = next;
    setDraggingState(next);
  };
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [comment, setComment] = useState('');
  const [reviewerName, setReviewerName] = useState(username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Одна отметка времени на монтирование: чипы всех карточек считаются от неё.
  const now = useMemo(() => new Date(), []);

  const canArchitect = hasArchitectPowers(role);
  const canDecide = (col: PackageColumnId) =>
    (col === 'tw' || col === 'gap') && canDecideReviewStage(role, col);

  const myPackageColumns = useMemo(
    () =>
      new Set<PackageColumnId>(
        PACKAGE_COLUMNS.map((c) => c.id).filter((id) =>
          id === 'draft' || id === 'rejected'
            ? hasArchitectPowers(role)
            : id !== 'approved' && canDecideReviewStage(role, id),
        ),
      ),
    [role],
  );
  const myEstimateColumns = useMemo(
    () =>
      new Set<EstimateColumnId>(
        hasArchitectPowers(role)
          ? ['est_pending', 'est_approved']
          : role === 'presale'
            ? ['est_draft']
            : [],
      ),
    [role],
  );

  const query = search.trim().toLowerCase();
  const filteredCards = useMemo(
    () =>
      cards.filter(
        (c) =>
          (!onlyMine || myPackageColumns.has(packageColumnOf(c))) &&
          (!query ||
            [c.name, c.customer, c.project.name, c.project.code ?? '', c.author]
              .join(' ')
              .toLowerCase()
              .includes(query)),
      ),
    [cards, onlyMine, myPackageColumns, query],
  );
  const filteredEstimates = useMemo(
    () =>
      estimates.filter(
        (c) =>
          (!onlyMine || myEstimateColumns.has(estimateColumnOf(c))) &&
          (!query ||
            [c.name, c.customer, c.project?.code ?? '', c.author, c.template]
              .join(' ')
              .toLowerCase()
              .includes(query)),
      ),
    [estimates, onlyMine, myEstimateColumns, query],
  );

  const packageDraggable = (card: BoardCard) => canDecide(packageColumnOf(card));
  // Сметы: «На утверждении» → «Смета утверждена» и есть утверждение
  // архитектором; возврат пресейлу идёт через редактор.
  const estimateDraggable = (card: EstimateCard) =>
    canArchitect && estimateColumnOf(card) === 'est_pending';

  function endDrag() {
    setDragging(null);
    setOverColumn(null);
  }

  function dropPackage(col: PackageColumnId) {
    const d = draggingRef.current;
    endDrag();
    if (d?.kind !== 'package') return;
    const decision = decisionFor(packageColumnOf(d.card), col);
    if (!decision) return;
    setComment('');
    setError(null);
    setPending({ kind: 'package', card: d.card, to: col, decision });
  }

  function dropEstimate(col: EstimateColumnId) {
    const d = draggingRef.current;
    endDrag();
    if (d?.kind !== 'estimate' || col !== 'est_approved' || !estimateDraggable(d.card)) return;
    setError(null);
    setPending({ kind: 'estimate', card: d.card });
  }

  async function confirmMove() {
    if (!pending) return;
    if (pending.kind === 'package' && pending.decision === 'reject' && !comment.trim()) {
      setError('Укажите, что нужно исправить: без замечания возврат бессмыслен.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res =
        pending.kind === 'estimate'
          ? await fetch(`/api/calculations/${pending.card.id}/approve`, { method: 'POST' })
          : await fetch(`/api/gost34/packages/${pending.card.id}/review`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                decision: pending.decision,
                comment: comment.trim() || undefined,
                reviewerName: reviewerName.trim() || undefined,
              }),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error ||
            (pending.kind === 'estimate'
              ? 'Не удалось утвердить смету'
              : 'Не удалось сохранить решение'),
        );
      }
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const total = filteredCards.length + filteredEstimates.length;
  const targetTitle =
    pending?.kind === 'package' ? PACKAGE_COLUMNS.find((c) => c.id === pending.to)?.title : '';

  return (
    <div className="page-wide">
      <PageHeader
        title="Доска заявок"
        description="Сметы на утверждение и комплекты ГОСТ 34 по этапам выпуска. Перетащите карточку в следующую колонку, чтобы вынести решение на своём этапе; черновики и возвраты выпускаются из Студии."
        actions={
          <span className="text-xs text-slate-500 dark:text-nord-muted">{total} на доске</span>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            aria-pressed={onlyMine}
            onClick={() => setOnlyMine((v) => !v)}
            className={`filter-chip ${onlyMine ? 'filter-chip-active' : ''}`}
          >
            Только мои этапы
          </button>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Комплект, заказчик, проект, автор…"
            aria-label="Поиск по доске"
            className="input w-full sm:w-72"
          />
        </div>
      </PageHeader>

      <section aria-labelledby="estimates-title" className="space-y-2">
        <h2 id="estimates-title" className="card-title">
          Сметы и оценки трудозатрат
        </h2>
        <Lane
          columns={ESTIMATE_COLUMNS}
          cards={filteredEstimates}
          columnOf={estimateColumnOf}
          mine={myEstimateColumns}
          canDrag={estimateDraggable}
          canDropInto={(col) => {
            const d = draggingRef.current;
            return d?.kind === 'estimate' && col === 'est_approved' && estimateDraggable(d.card);
          }}
          dragging={dragging?.kind === 'estimate' ? dragging.card : null}
          overColumn={overColumn}
          onDragStart={(card) => setDragging({ kind: 'estimate', card })}
          onDragEnd={endDrag}
          onDragOver={(col) => overColumn !== col && setOverColumn(col)}
          onDrop={dropEstimate}
          now={now}
          minHeight="min-h-[180px]"
          renderCard={(card, col, days) => (
            <>
              <CardTitle
                href={`/calculations/${card.id}`}
                name={card.name}
                version={card.version}
              />
              <div className="truncate text-[11px] text-slate-500 dark:text-nord-muted">
                <ProjectCode code={card.project?.code ?? null} />
                {card.customer} · {card.template}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="nums text-xs font-bold text-slate-900 dark:text-nord-6">
                  {card.totalHours} ч
                </span>
                {col.stage && <span className={toneFor(col, days)}>{formatDays(days)}</span>}
                <span className="ml-auto text-[10px] text-slate-400 dark:text-nord-muted">
                  {card.author}
                </span>
              </div>
              <div className="flex items-center gap-1 pt-1">
                {col.id === 'est_draft' ? (
                  <Link href={`/presale/${card.id}`} className="btn-secondary btn-sm">
                    Опросник
                  </Link>
                ) : (
                  <Link href={`/architect/${card.id}`} className="btn-secondary btn-sm">
                    {col.id === 'est_pending' && canArchitect ? 'Проверить' : 'Архитектор'}
                  </Link>
                )}
                {col.id === 'est_approved' && canArchitect && (
                  <Link href={`/calculations/${card.id}/studio`} className="btn-ghost btn-sm">
                    В Студию
                  </Link>
                )}
                {card.project && (
                  <Link href={`/projects/${card.project.id}`} className="btn-ghost btn-sm">
                    Проект
                  </Link>
                )}
              </div>
            </>
          )}
        />
      </section>

      <section aria-labelledby="packages-title" className="space-y-2">
        <h2 id="packages-title" className="card-title">
          Комплекты ГОСТ 34
        </h2>
        <Lane
          columns={PACKAGE_COLUMNS}
          cards={filteredCards}
          columnOf={packageColumnOf}
          mine={myPackageColumns}
          canDrag={packageDraggable}
          canDropInto={(col) => {
            const d = draggingRef.current;
            return d?.kind === 'package' && decisionFor(packageColumnOf(d.card), col) !== null;
          }}
          dragging={dragging?.kind === 'package' ? dragging.card : null}
          overColumn={overColumn}
          onDragStart={(card) => setDragging({ kind: 'package', card })}
          onDragEnd={endDrag}
          onDragOver={(col) => overColumn !== col && setOverColumn(col)}
          onDrop={dropPackage}
          now={now}
          minHeight="min-h-[320px]"
          renderCard={(card, col, days) => {
            const reviewHref = `/review/${card.id}`;
            const studioHref = `/calculations/${card.calculationId}/studio`;
            return (
              <>
                <CardTitle
                  href={col.id === 'draft' ? studioHref : reviewHref}
                  name={card.name}
                  version={card.version}
                />
                <div className="truncate text-[11px] text-slate-500 dark:text-nord-muted">
                  <ProjectCode code={card.project.code} />
                  {card.customer}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {col.stage && <span className={toneFor(col, days)}>{formatDays(days)}</span>}
                  {(col.id === 'tw' || col.id === 'gap') && card.openBlockers > 0 && (
                    <span className="chip-block" title="Открытые блокеры нормоконтроля">
                      блокеров: {card.openBlockers}
                    </span>
                  )}
                  {col.id === 'approved' && card.approvedBy && (
                    <span className="chip-ok">подписал {card.approvedBy}</span>
                  )}
                  <span className="ml-auto text-[10px] text-slate-400 dark:text-nord-muted">
                    {card.author}
                  </span>
                </div>
                {col.id === 'rejected' && card.reviewComment && (
                  <p className="line-clamp-2 rounded border-l-2 border-rose-400 bg-rose-50/60 px-2 py-1 text-[11px] italic text-rose-900 dark:bg-nord-red/15 dark:text-nord-redText">
                    {card.reviewComment}
                  </p>
                )}
                <div className="flex items-center gap-1 pt-1">
                  {col.id === 'draft' || col.id === 'rejected' ? (
                    canArchitect ? (
                      <Link href={studioHref} className="btn-secondary btn-sm">
                        {col.id === 'rejected' ? 'Исправить' : 'В Студию'}
                      </Link>
                    ) : (
                      <Link href={reviewHref} className="btn-ghost btn-sm">
                        Открыть
                      </Link>
                    )
                  ) : (
                    <Link href={reviewHref} className="btn-secondary btn-sm">
                      {canDecide(col.id) ? 'Ревью' : 'Открыть'}
                    </Link>
                  )}
                  {card.project.id && (
                    <Link
                      href={`/projects/${card.project.id}`}
                      className="btn-ghost btn-sm"
                      title={card.project.name}
                    >
                      Проект
                    </Link>
                  )}
                </div>
              </>
            );
          }}
        />
      </section>

      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="board-move-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
        >
          <div className="card animate-in w-full max-w-md overflow-hidden shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-nord-3 dark:bg-nord-1/60">
              <h3
                id="board-move-title"
                className="text-sm font-bold text-slate-900 dark:text-nord-6"
              >
                {pending.kind === 'estimate'
                  ? 'Утвердить смету'
                  : pending.decision === 'approve'
                    ? `Передать в «${targetTitle}»`
                    : 'Вернуть с замечаниями'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-nord-muted">
                {pending.card.name} · v{pending.card.version} · {pending.card.customer}
              </p>
            </div>
            <div className="space-y-3 p-5">
              {error && (
                <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </div>
              )}
              {pending.kind === 'estimate' ? (
                <p className="text-xs text-slate-600 dark:text-nord-4">
                  Смета на {pending.card.totalHours} ч будет утверждена от вашего имени; после этого
                  её этапы и трудозатраты редактировать нельзя.
                </p>
              ) : (
                <>
                  {pending.decision === 'approve' && pending.card.openBlockers > 0 && (
                    <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-nord-yellow/15 dark:text-nord-yellow">
                      У комплекта {pending.card.openBlockers} открытых блокеров: сервер не пропустит
                      его дальше, пока они не закрыты на экране ревью.
                    </div>
                  )}
                  <div>
                    <label className="label">ФИО и должность</label>
                    <input
                      className="input"
                      value={reviewerName}
                      onChange={(e) => setReviewerName(e.target.value)}
                      placeholder="ФИО и должность"
                    />
                  </div>
                  <div>
                    <label className="label">
                      {pending.decision === 'approve' ? 'Комментарий' : 'Замечания *'}
                    </label>
                    <textarea
                      className="input"
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={
                        pending.decision === 'approve'
                          ? 'Необязательно'
                          : 'Что нужно исправить перед повторным выпуском'
                      }
                    />
                  </div>
                </>
              )}
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-nord-3">
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="btn-secondary"
                  disabled={busy}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={confirmMove}
                  disabled={busy}
                  className={
                    pending.kind === 'package' && pending.decision === 'reject'
                      ? 'btn-danger'
                      : 'btn-primary'
                  }
                >
                  {busy
                    ? 'Сохраняем…'
                    : pending.kind === 'estimate'
                      ? 'Утвердить'
                      : pending.decision === 'approve'
                        ? 'Подтвердить'
                        : 'Вернуть'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
