'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type DragEvent } from 'react';
import PageHeader from '@/components/PageHeader';
import { hasArchitectPowers } from '@/lib/appRoles';
import { formatDays } from '@/lib/lifecycle';
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

type ColumnId = 'draft' | 'tw' | 'gap' | 'rejected' | 'approved';

interface Column {
  id: ColumnId;
  title: string;
  owner: string;
  hint: string;
  /** Пороги «висит» в днях: после warn чип желтеет, после stale краснеет. */
  warn: number;
  stale: number;
}

const COLUMNS: Column[] = [
  {
    id: 'draft',
    title: 'Черновик',
    owner: 'архитектор',
    hint: 'Собирается в Студии. Выпуск переводит комплект на нормоконтроль.',
    warn: 7,
    stale: 14,
  },
  {
    id: 'tw',
    title: 'Нормоконтроль',
    owner: 'тех.писатель',
    hint: 'Чек-лист оформления и замечания по разделам.',
    warn: 2,
    stale: 5,
  },
  {
    id: 'gap',
    title: 'Ревью ГАП',
    owner: 'ГАП',
    hint: 'Финальное решение о выпуске.',
    warn: 2,
    stale: 5,
  },
  {
    id: 'rejected',
    title: 'Возвращён',
    owner: 'архитектор',
    hint: 'Исправить замечания в Студии и выпустить заново.',
    warn: 3,
    stale: 7,
  },
  {
    id: 'approved',
    title: 'Утверждён',
    owner: '—',
    hint: 'Выпущенные за последние 30 дней.',
    warn: Infinity,
    stale: Infinity,
  },
];

function columnOf(card: BoardCard): ColumnId {
  if (card.status === 'approved') return 'approved';
  if (card.status === 'rejected') return 'rejected';
  if (card.status === 'under_review') return card.reviewStage === 'gap' ? 'gap' : 'tw';
  return 'draft';
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * Переход карточки перетаскиванием — это вердикт ревью: колонка-источник
 * задаёт этап, колонка-цель — решение. Всё остальное (выпуск черновика,
 * повторный выпуск возвращённого) делается в Студии, и такие карточки не
 * перетаскиваются.
 */
function decisionFor(from: ColumnId, to: ColumnId): 'approve' | 'reject' | null {
  if (from === 'tw' && to === 'gap') return 'approve';
  if (from === 'gap' && to === 'approved') return 'approve';
  if ((from === 'tw' || from === 'gap') && to === 'rejected') return 'reject';
  return null;
}

interface PendingMove {
  card: BoardCard;
  from: ColumnId;
  to: ColumnId;
  decision: 'approve' | 'reject';
}

export default function BoardClient({
  cards,
  role,
  username,
}: {
  cards: BoardCard[];
  role: string;
  username: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [overColumn, setOverColumn] = useState<ColumnId | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [comment, setComment] = useState('');
  const [reviewerName, setReviewerName] = useState(username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canArchitect = hasArchitectPowers(role);
  const canDecide = (col: ColumnId) =>
    (col === 'tw' || col === 'gap') && canDecideReviewStage(role, col);
  const myColumns = new Set<ColumnId>(
    COLUMNS.map((c) => c.id).filter((id) =>
      id === 'draft' || id === 'rejected' ? canArchitect : canDecide(id),
    ),
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (onlyMine && !myColumns.has(columnOf(c))) return false;
      if (!q) return true;
      return [c.name, c.customer, c.project.name, c.project.code ?? '', c.author]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, search, onlyMine, role]);

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, BoardCard[]> = {
      draft: [],
      tw: [],
      gap: [],
      rejected: [],
      approved: [],
    };
    for (const c of filtered) map[columnOf(c)].push(c);
    for (const list of Object.values(map)) {
      list.sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());
    }
    return map;
  }, [filtered]);

  const draggable = (card: BoardCard) => canDecide(columnOf(card));

  function onDragStart(e: DragEvent<HTMLElement>, card: BoardCard) {
    if (!draggable(card)) {
      e.preventDefault();
      return;
    }
    setDragging(card);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  }

  function onDragOver(e: DragEvent<HTMLElement>, col: ColumnId) {
    if (!dragging) return;
    if (!decisionFor(columnOf(dragging), col)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overColumn !== col) setOverColumn(col);
  }

  function onDrop(e: DragEvent<HTMLElement>, col: ColumnId) {
    e.preventDefault();
    setOverColumn(null);
    if (!dragging) return;
    const from = columnOf(dragging);
    const decision = decisionFor(from, col);
    setDragging(null);
    if (!decision) return;
    setComment('');
    setError(null);
    setPending({ card: dragging, from, to: col, decision });
  }

  async function confirmMove() {
    if (!pending) return;
    if (pending.decision === 'reject' && !comment.trim()) {
      setError('Укажите, что нужно исправить: без замечания возврат бессмыслен.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/gost34/packages/${pending.card.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: pending.decision,
          comment: comment.trim() || undefined,
          reviewerName: reviewerName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить решение');
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const total = filtered.length;
  const targetTitle = pending ? COLUMNS.find((c) => c.id === pending.to)?.title : '';

  return (
    <div className="page-wide">
      <PageHeader
        title="Доска комплектов"
        description="Комплекты ГОСТ 34 по этапам выпуска. Перетащите карточку в следующую колонку, чтобы вынести решение на своём этапе; черновики и возвраты выпускаются из Студии."
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((col) => {
          const list = byColumn[col.id];
          const mine = myColumns.has(col.id);
          const dropTarget = dragging ? decisionFor(columnOf(dragging), col.id) : null;
          const over = overColumn === col.id && dropTarget;
          return (
            <section
              key={col.id}
              aria-label={col.title}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={() => overColumn === col.id && setOverColumn(null)}
              onDrop={(e) => onDrop(e, col.id)}
              className={`flex min-h-[320px] flex-col rounded-xl border transition-colors ${
                over
                  ? 'border-brand-500 bg-brand-50/60 dark:border-nord-frost2 dark:bg-nord-frost4/20'
                  : dragging && dropTarget
                    ? 'border-dashed border-brand-300 bg-brand-50/20 dark:border-nord-frost4 dark:bg-nord-3/40'
                    : mine
                      ? 'border-slate-200 bg-slate-50 dark:border-nord-3 dark:bg-nord-1/50'
                      : 'border-slate-200 bg-slate-100/60 dark:border-nord-3 dark:bg-nord-0'
              }`}
            >
              <header className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-nord-4">
                    {col.title}
                    {mine && (
                      <span className="chip-info" title="На этом этапе решение за вами">
                        вы
                      </span>
                    )}
                  </h2>
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
                    const days = daysSince(card.enteredAt);
                    const tone =
                      days >= col.stale
                        ? 'chip-block'
                        : days >= col.warn
                          ? 'chip-warn'
                          : 'chip-muted';
                    const canDrag = draggable(card);
                    const reviewHref = `/review/${card.id}`;
                    const studioHref = `/calculations/${card.calculationId}/studio`;
                    return (
                      <article
                        key={card.id}
                        draggable={canDrag}
                        onDragStart={(e) => onDragStart(e, card)}
                        onDragEnd={() => {
                          setDragging(null);
                          setOverColumn(null);
                        }}
                        className={`card space-y-1.5 p-3 ${
                          canDrag ? 'cursor-grab active:cursor-grabbing' : ''
                        } ${dragging?.id === card.id ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={col.id === 'draft' ? studioHref : reviewHref}
                            className="min-w-0 truncate text-xs font-bold text-slate-900 hover:text-brand-700 dark:text-nord-6 dark:hover:text-nord-frost2"
                            title={card.name}
                          >
                            {card.name}
                          </Link>
                          <span className="nums shrink-0 text-[10px] font-semibold text-slate-400 dark:text-nord-muted">
                            v{card.version}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-nord-muted">
                          {card.project.code && (
                            <span className="mr-1 font-mono font-bold text-brand-600 dark:text-nord-frost3">
                              {card.project.code}
                            </span>
                          )}
                          {card.customer}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {col.id !== 'approved' && (
                            <span className={tone}>{formatDays(days)}</span>
                          )}
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
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

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
                {pending.decision === 'approve'
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
              {pending.decision === 'approve' && pending.card.openBlockers > 0 && (
                <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-nord-yellow/15 dark:text-nord-yellow">
                  У комплекта {pending.card.openBlockers} открытых блокеров: сервер не пропустит его
                  дальше, пока они не закрыты на экране ревью.
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
                  className={pending.decision === 'reject' ? 'btn-danger' : 'btn-primary'}
                >
                  {busy ? 'Сохраняем…' : pending.decision === 'approve' ? 'Подтвердить' : 'Вернуть'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
