'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { safeJsonParse } from '@/lib/json';
import type { GostWizardSnapshot } from '@/lib/project';
import {
  COMMENT_SEVERITY_LABELS,
  COMMENT_STATUS_LABELS,
  countBySeverity,
  isCommentResolved,
  openBlockerCount,
  REVIEW_STAGE_LABELS,
  type ChecklistItem,
  type ChecklistState,
  type CommentSeverity,
  type ReviewStage,
  type CommentStatus,
  type SectionComment,
} from '@/lib/gost34/review/types';
import type { SerializedAssignment } from '@/lib/review/store';
import {
  canMarkCommentFixed,
  canResolveComment,
  isAssignmentOverdue,
  type AssignableStage,
  type CommentAction,
  type ReviewActor,
} from '@/lib/review/workflow';

export interface ReviewQueueItem {
  id: string;
  name: string;
  version: number;
  customerName: string;
  releasedAt: string | null;
  stage: ReviewStage;
  /** Дней с момента выпуска — по нему считается срочность в очереди. */
  ageDays: number;
  /** Персональный ответственный за текущий этап (#103). */
  assignment?: { assigneeName: string; dueAt: string };
}

export interface AssignCandidate {
  id: string;
  username: string;
  role: string;
}

export interface SerializedReviewPackage {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewStage: ReviewStage;
  calculationId: string;
  calculationName: string;
  projectName: string;
  customerName: string;
  projectCode: string | null;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string;
  checksum: string | null;
  hasArtifact: boolean;
  releasedAt: string | null;
  releasedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  reviewComment?: string | null;
  createdAt: string;
  snapshot: GostWizardSnapshot;
  checklist: ChecklistItem[];
  comments: SectionComment[];
  /** Активные назначения по этапам. */
  assignments: SerializedAssignment[];
  twVersion: {
    name: string;
    uploadedAt: string | null;
    uploadedBy: string | null;
    isPriority: boolean;
  } | null;
}

const CHECK_MARK: Record<ChecklistState, { mark: string; cls: string }> = {
  ok: {
    mark: '✓',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-nord-green/15 dark:text-nord-green',
  },
  block: { mark: '✕', cls: 'bg-rose-50 text-rose-700 dark:bg-nord-red/15 dark:text-nord-redText' },
  warn: {
    mark: '!',
    cls: 'bg-amber-50 text-amber-700 dark:bg-nord-yellow/15 dark:text-nord-yellow',
  },
  empty: { mark: '·', cls: 'bg-slate-100 text-slate-400 dark:bg-nord-1 dark:text-nord-muted' },
};

/** Следующее состояние пункта по клику: пройдено → замечание → блокер → не проверено. */
const NEXT_STATE: Record<ChecklistState, ChecklistState> = {
  empty: 'ok',
  ok: 'warn',
  warn: 'block',
  block: 'empty',
};

const STATUS_CHIP: Record<CommentStatus, string> = {
  open: 'chip-warn',
  fixed: 'chip-muted',
  verified: 'chip-ok',
  rejected: 'chip-muted',
};

const SEVERITY_TONE: Record<CommentSeverity, string> = {
  blocker: 'text-rose-700 dark:text-nord-redText',
  remark: 'text-amber-700 dark:text-nord-yellow',
  suggestion: 'text-slate-500 dark:text-nord-muted',
};

function urgencyChip(ageDays: number): { label: string; cls: string } {
  if (ageDays >= 5) return { label: 'срочно', cls: 'chip-block' };
  if (ageDays >= 2) return { label: `${ageDays} дня`, cls: 'chip-warn' };
  return { label: ageDays <= 0 ? 'сегодня' : `${ageDays} дн.`, cls: 'chip-muted' };
}

export default function PackageReviewClient({
  pkg,
  queue,
  shareToken,
  canReview,
  canParticipate,
  actor,
  canAssignStages,
  assignCandidates,
}: {
  pkg: SerializedReviewPackage;
  queue: ReviewQueueItem[];
  shareToken: string | null;
  /** Роль позволяет выносить вердикт на текущем этапе. */
  canReview: boolean;
  /** Есть право review: ответы, отметка «исправлено», закрытие своих замечаний. */
  canParticipate: boolean;
  actor: ReviewActor;
  /** Этапы, на которые пользователь вправе назначать ответственного. */
  canAssignStages: AssignableStage[];
  assignCandidates: Partial<Record<AssignableStage, AssignCandidate[]>>;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<'checklist' | 'sections'>('checklist');
  const [checklist, setChecklist] = useState(pkg.checklist);
  const [comments, setComments] = useState(pkg.comments);
  const [assignments, setAssignments] = useState(pkg.assignments);
  const [twVersion, setTwVersion] = useState(pkg.twVersion);

  const [reviewerName, setReviewerName] = useState('');
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject'>('reject');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const docTypes = safeJsonParse<string[]>(pkg.documentTypes, ['tz']);
  const shareQuery = shareToken ? `?share=${encodeURIComponent(shareToken)}` : '';
  const downloadUrl = `/api/gost34/packages/${pkg.id}/artifact${shareQuery}`;
  const twDownloadUrl = `/api/gost34/packages/${pkg.id}/tw-version${shareQuery}`;

  const counts = useMemo(() => countBySeverity(comments), [comments]);
  const blockers = useMemo(() => openBlockerCount(comments, checklist), [comments, checklist]);
  const isFinal = pkg.status === 'approved';

  /**
   * Разделы берутся из снимка мастера: комментарий привязывается к разделу
   * документа, а не к абстрактной строке, — так его видно и в студии.
   */
  const sections = useMemo(() => {
    const overrides = pkg.snapshot.sectionOverrides || {};
    const titles = Object.keys(overrides);
    return titles.length > 0
      ? titles
      : [
          '1 Общие сведения',
          '3 Характеристика объекта автоматизации',
          '4 Требования к системе',
          '6 Порядок контроля и приёмки',
        ];
  }, [pkg.snapshot.sectionOverrides]);

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (shareToken) h['x-share-token'] = shareToken;
    return h;
  }

  /** Состояние ревью сохраняется сразу — закрытая вкладка не должна стоить работы. */
  async function persist(next: { checklist?: ChecklistItem[] }) {
    try {
      await fetch(`/api/gost34/packages/${pkg.id}/review-state${shareQuery}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(next),
      });
    } catch (err) {
      console.error('Не удалось сохранить состояние ревью:', err);
    }
  }

  function cycleChecklistItem(id: string) {
    if (isFinal || !canReview) return;
    const next = checklist.map((item) =>
      item.id === id ? { ...item, state: NEXT_STATE[item.state] } : item,
    );
    setChecklist(next);
    persist({ checklist: next });
  }

  /** Замечание с сервера заменяет локальную копию — статусы и ответы приходят оттуда. */
  function applyComment(next: SectionComment) {
    setComments((prev) =>
      prev.some((c) => c.id === next.id)
        ? prev.map((c) => (c.id === next.id ? { ...c, ...next } : c))
        : [...prev, next],
    );
  }

  async function callComments(
    path: string,
    method: 'POST' | 'PATCH',
    body: Record<string, unknown>,
  ): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(`/api/gost34/packages/${pkg.id}/comments${path}${shareQuery}`, {
        method,
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить замечание');
      applyComment(data.comment);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения замечания');
      return false;
    }
  }

  function addComment(sectionId: string, severity: CommentSeverity, text: string) {
    return callComments('', 'POST', {
      sectionId,
      severity,
      text,
      author: reviewerName.trim() || undefined,
    });
  }

  function changeStatus(id: string, action: CommentAction) {
    return callComments(`/${encodeURIComponent(id)}`, 'PATCH', { action });
  }

  function reply(id: string, text: string) {
    return callComments(`/${encodeURIComponent(id)}`, 'POST', {
      text,
      author: reviewerName.trim() || undefined,
    });
  }

  async function assign(
    stage: AssignableStage,
    input: { assigneeId: string; deputyId: string; dueAt: string },
  ): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(`/api/gost34/packages/${pkg.id}/assignments`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          stage,
          assigneeId: input.assigneeId,
          deputyId: input.deputyId || undefined,
          dueAt: input.dueAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось назначить ответственного');
      setAssignments((prev) => [...prev.filter((a) => a.stage !== stage), data.assignment]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка назначения');
      return false;
    }
  }

  async function handleUpload(file: File) {
    setError(null);
    setIsUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);

      const h: Record<string, string> = {};
      if (shareToken) h['x-share-token'] = shareToken;

      const res = await fetch(`/api/gost34/packages/${pkg.id}/tw-version${shareQuery}`, {
        method: 'POST',
        headers: h,
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось загрузить версию');

      setTwVersion({
        name: data.twVersion.name,
        uploadedAt: data.twVersion.uploadedAt,
        uploadedBy: data.twVersion.uploadedBy,
        isPriority: data.twVersion.isPriority,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setIsUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function submitVerdict(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/gost34/packages/${pkg.id}/review${shareQuery}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          decision,
          comment,
          reviewerName: reviewerName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось отправить решение');

      setSuccess(
        decision === 'reject'
          ? 'Комплект возвращён с замечаниями.'
          : pkg.reviewStage === 'tw'
            ? 'Нормоконтроль пройден — комплект передан ГАП на финальное ревью.'
            : 'Комплект утверждён.',
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при отправке');
    } finally {
      setIsSubmitting(false);
    }
  }

  const approveBlocked = blockers > 0;

  return (
    <div className="grid gap-3.5 xl:grid-cols-[210px_minmax(360px,1fr)_250px]">
      {/* ---------- Очередь ---------- */}
      <div className="space-y-1.5">
        <div className="label">Очередь ревью · {queue.length}</div>
        {queue.length === 0 && (
          <p className="text-[11px] text-slate-400 dark:text-nord-muted">Очередь пуста.</p>
        )}
        {queue.map((item) => {
          const chip = urgencyChip(item.ageDays);
          const selected = item.id === pkg.id;
          return (
            <Link
              key={item.id}
              href={`/review/${item.id}`}
              className={`flex flex-col rounded-[10px] border px-3 py-2.5 transition-colors ${
                selected
                  ? 'border-brand-600 bg-white ring-1 ring-brand-600 dark:bg-nord-2'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-nord-3 dark:bg-nord-2'
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-nord-6">
                  {item.name}
                </span>
                <span className={chip.cls}>{chip.label}</span>
              </span>
              <span className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-nord-muted">
                {item.customerName} · v{item.version} · {REVIEW_STAGE_LABELS[item.stage]}
              </span>
              {item.assignment && (
                <span
                  className={`mt-0.5 truncate text-[10px] ${
                    isAssignmentOverdue(item.assignment.dueAt)
                      ? 'font-bold text-rose-700 dark:text-nord-redText'
                      : 'text-slate-500 dark:text-nord-muted'
                  }`}
                >
                  → {item.assignment.assigneeName} · до{' '}
                  {new Date(item.assignment.dueAt).toLocaleDateString('ru-RU')}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* ---------- Рабочая область ---------- */}
      <div className="min-w-0 space-y-3">
        <div className="card-flat p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip-muted font-mono">ГОСТ 34</span>
            <span className="chip-muted nums font-mono">v{pkg.version}</span>
            <span className={isFinal ? 'chip-ok' : 'chip-warn'}>
              {isFinal
                ? 'утверждён'
                : pkg.status === 'rejected'
                  ? 'возвращён с замечаниями'
                  : 'на ревью'}
            </span>
          </div>

          <h1 className="mt-2 text-lg font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
            {pkg.name}
          </h1>

          <p className="mt-1 text-[11px] text-slate-500 dark:text-nord-muted">
            {pkg.customerName} · выпуск{' '}
            {new Date(pkg.releasedAt || pkg.createdAt).toLocaleDateString('ru-RU')}
            {pkg.checksum && (
              <>
                {' '}
                · SHA-256 {pkg.checksum.slice(0, 4)}…{pkg.checksum.slice(-4)}
              </>
            )}
            {pkg.hasArtifact && (
              <>
                {' · '}
                <a
                  href={downloadUrl}
                  download
                  className="font-semibold text-brand-700 hover:underline dark:text-nord-frost2"
                >
                  скачать ZIP
                </a>
              </>
            )}
          </p>

          <p className="mt-1 text-[10px] text-slate-400 dark:text-nord-muted">
            Состав: {docTypes.map((d) => d.toUpperCase()).join(', ')} · профиль{' '}
            {pkg.standardProfileId} ({pkg.standardProfileVersion})
          </p>

          {pkg.status === 'rejected' && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/80 p-3 dark:border-nord-red/40 dark:bg-nord-red/10 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white dark:bg-nord-red">
                    !
                  </span>
                  <span className="text-xs font-bold text-rose-900 dark:text-nord-redText">
                    Комплект возвращён с замечаниями
                  </span>
                </div>
                <Link
                  href={`/calculations/${pkg.calculationId}/studio`}
                  className="btn-primary bg-rose-600! hover:bg-rose-700! dark:bg-nord-red! px-3! py-1! text-xs! font-bold!"
                >
                  ✏️ Открыть в Студии ГОСТ 34 для исправления →
                </Link>
              </div>
              {pkg.reviewComment && (
                <div className="rounded-sm border-l-2 border-rose-600 bg-white dark:bg-nord-2 p-2.5 text-xs italic text-slate-800 dark:text-nord-5">
                  «{pkg.reviewComment}»
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:bg-nord-red/15 dark:text-nord-redText">
            {error}
          </div>
        )}

        <div className="flex gap-1 border-b border-slate-200 dark:border-nord-3">
          {(
            [
              ['checklist', 'Чек-лист нормоконтроля'],
              ['sections', 'Разделы и комментарии'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`border-b-2 px-3.5 py-2 text-xs font-bold transition-colors ${
                tab === id
                  ? 'border-brand-600 text-brand-700 dark:border-nord-frost2 dark:text-nord-frost2'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:text-nord-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'checklist' ? (
          <div className="card-flat divide-y divide-slate-100 dark:divide-nord-3">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-nord-muted">
                Автопроверки и ручные пункты · клик по строке меняет отметку
              </span>
              <span className="nums text-[11px] font-bold text-slate-600 dark:text-nord-4">
                {checklist.filter((c) => c.state === 'ok').length} из {checklist.length} пройдено
              </span>
            </div>

            {checklist.map((item) => {
              const mark = CHECK_MARK[item.state];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => cycleChecklistItem(item.id)}
                  disabled={isFinal || !canReview}
                  className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-nord-1"
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <span className={`check-mark ${mark.cls}`}>{mark.mark}</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-900 dark:text-nord-6">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-400 dark:text-nord-muted">
                        {item.note}
                      </span>
                    </span>
                  </span>
                  <span className="chip-muted shrink-0">
                    {item.kind === 'auto' ? 'авто' : 'вручную'}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {[
              ...sections,
              // Замечания к разделам, которых нет в текущем снимке (например,
              // перенесённые из ранней версии), не должны теряться.
              ...Array.from(new Set(comments.map((c) => c.sectionId))).filter(
                (id) => !sections.includes(id),
              ),
            ].map((sectionId) => {
              const sectionComments = comments.filter((c) => c.sectionId === sectionId);
              return (
                <SectionCard
                  key={sectionId}
                  sectionId={sectionId}
                  comments={sectionComments}
                  packageVersion={pkg.version}
                  actor={actor}
                  canAdd={!isFinal && canReview}
                  canParticipate={!isFinal && canParticipate}
                  onAdd={(severity, text) => addComment(sectionId, severity, text)}
                  onStatus={changeStatus}
                  onReply={reply}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ---------- Версия тех.писателя и вердикт ---------- */}
      <div className="space-y-3 xl:sticky xl:top-[calc(var(--app-header-h)+1rem)] xl:self-start">
        <div className="card-flat space-y-2.5 p-3.5">
          <div className="text-xs font-extrabold text-slate-900 dark:text-nord-6">
            Версия тех.писателя
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-nord-muted">
            Скачайте комплект, внесите правки и загрузите свою версию — она станет приоритетной для
            выпуска.
          </p>

          <div className="flex gap-2">
            {pkg.hasArtifact && (
              <a href={downloadUrl} download className="btn-secondary flex-1 px-2! text-[11px]!">
                ⬇ Скачать v{pkg.version}
              </a>
            )}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={isUploading || isFinal || !canReview}
              className="btn-secondary flex-1 px-2! text-[11px]!"
            >
              {isUploading ? 'Загрузка…' : '⬆ Загрузить свою'}
            </button>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />

          {twVersion && (
            <div className="space-y-1 rounded-lg bg-emerald-50 px-2.5 py-2 dark:bg-nord-green/15">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 truncate text-[11px] font-bold text-emerald-900 dark:text-nord-green">
                  {twVersion.name}
                </span>
                {twVersion.isPriority && <span className="chip-ok">приоритетная</span>}
              </div>
              <div className="text-[10px] text-emerald-800/80 dark:text-nord-green/80">
                <a href={twDownloadUrl} download className="font-semibold hover:underline">
                  скачать
                </a>{' '}
                · изменения зафиксированы в{' '}
                <Link
                  href={`/calculations/${pkg.calculationId}/changelog`}
                  className="font-semibold hover:underline"
                >
                  листе внутренних изменений
                </Link>
              </div>
            </div>
          )}
        </div>

        <AssignmentsCard
          assignments={assignments}
          currentStage={pkg.reviewStage}
          canAssignStages={isFinal ? [] : canAssignStages}
          candidates={assignCandidates}
          onAssign={assign}
        />

        <div className="card-flat space-y-2.5 p-3.5">
          <div className="text-xs font-extrabold text-slate-900 dark:text-nord-6">
            Вердикт ревью
          </div>

          <div className="space-y-1">
            {(['tw', 'gap'] as const).map((stage, idx) => {
              const active = pkg.reviewStage === stage;
              const done =
                pkg.reviewStage === 'done' || (stage === 'tw' && pkg.reviewStage === 'gap');
              return (
                <div
                  key={stage}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ${
                    active
                      ? 'bg-brand-50 font-bold text-brand-700 dark:bg-nord-3 dark:text-nord-frost2'
                      : 'text-slate-500 dark:text-nord-muted'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold ${
                      done
                        ? 'bg-emerald-500 text-white'
                        : active
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-200 text-slate-500 dark:bg-nord-1'
                    }`}
                  >
                    {done ? '✓' : idx + 1}
                  </span>
                  {REVIEW_STAGE_LABELS[stage]}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-1.5 border-y border-slate-100 py-2 dark:border-nord-3">
            {(
              [
                ['Блокеры', counts.blocker, 'text-rose-700 dark:text-nord-redText'],
                ['Замечания', counts.remark, 'text-amber-700 dark:text-nord-yellow'],
                ['Предложения', counts.suggestion, 'text-slate-600 dark:text-nord-4'],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label} className="text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-nord-muted">
                  {label}
                </div>
                <div className={`nums text-base font-extrabold ${tone}`}>{value}</div>
              </div>
            ))}
          </div>

          {isFinal ? (
            <div className="space-y-1 rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] dark:bg-nord-green/15">
              <div className="font-bold text-emerald-900 dark:text-nord-green">
                ✓ Комплект утверждён
              </div>
              <div className="text-emerald-800/80 dark:text-nord-green/80">
                {pkg.approvedBy || 'Ревьювер'} ·{' '}
                {pkg.approvedAt ? new Date(pkg.approvedAt).toLocaleDateString('ru-RU') : ''}
              </div>
              {pkg.reviewComment && (
                <div className="italic text-emerald-800/80 dark:text-nord-green/80">
                  «{pkg.reviewComment}»
                </div>
              )}
            </div>
          ) : pkg.status === 'rejected' ? (
            <div className="space-y-2.5 rounded-lg bg-rose-50 p-3 text-[11px] dark:bg-nord-red/15">
              <div className="font-bold text-rose-900 dark:text-nord-redText">
                ✕ Комплект отклонён с замечаниями
              </div>
              {pkg.reviewComment && (
                <div className="rounded-sm bg-white/70 dark:bg-nord-2/70 p-2 italic text-rose-800 dark:text-nord-redText">
                  «{pkg.reviewComment}»
                </div>
              )}
              <Link
                href={`/calculations/${pkg.calculationId}/studio`}
                className="btn-primary bg-rose-600! hover:bg-rose-700! dark:bg-nord-red! w-full block text-center py-1.5! text-xs! font-bold!"
              >
                ✏️ Исправить в Студии ГОСТ 34 →
              </Link>
            </div>
          ) : !canReview ? (
            <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500 dark:bg-nord-1 dark:text-nord-muted">
              У вашей роли нет права выносить решение по этому комплекту.
            </p>
          ) : (
            <form onSubmit={submitVerdict} className="space-y-2">
              {success && (
                <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-800 dark:bg-nord-green/15 dark:text-nord-green">
                  {success}
                </div>
              )}
              {error && (
                <div className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700 dark:bg-nord-red/15 dark:text-nord-redText">
                  {error}
                </div>
              )}

              <input
                type="text"
                required
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="ФИО и должность"
                className="input py-1.5! text-[11px]!"
              />

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDecision('approve')}
                  className={`rounded-lg border px-2 py-2 text-center text-[11px] font-bold transition-colors ${
                    decision === 'approve'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-nord-green/15 dark:text-nord-green'
                      : 'border-slate-200 bg-white text-slate-500 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-4'
                  }`}
                >
                  Утвердить комплект
                </button>
                <button
                  type="button"
                  onClick={() => setDecision('reject')}
                  className={`rounded-lg border px-2 py-2 text-center text-[11px] font-bold transition-colors ${
                    decision === 'reject'
                      ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-nord-yellow/15 dark:text-nord-yellow'
                      : 'border-slate-200 bg-white text-slate-500 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-4'
                  }`}
                >
                  Вернуть с замечаниями
                </button>
              </div>

              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Итоговый комментарий (войдёт в протокол ревью)"
                className="input py-1.5! text-[11px]!"
              />

              <button
                type="submit"
                disabled={isSubmitting || (decision === 'approve' && approveBlocked)}
                title={
                  decision === 'approve' && approveBlocked
                    ? 'Есть открытый блокер — утверждение недоступно'
                    : undefined
                }
                className="w-full rounded-lg bg-slate-900 py-2 text-[11px] font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-nord-frost4 dark:hover:bg-nord-frost3 dark:disabled:bg-nord-3"
              >
                {isSubmitting
                  ? 'Отправка…'
                  : decision === 'approve' && approveBlocked
                    ? `Утвердить (заблокировано: ${blockers})`
                    : 'Отправить решение'}
              </button>

              <p className="text-[10px] leading-relaxed text-slate-400 dark:text-nord-muted">
                Решение тех.писателя уходит ГАП на финальное ревью. Утверждение недоступно, пока
                открыт хотя бы один блокер — исправленный, но не проверенный тоже считается
                открытым; всё фиксируется в реестре выпусков и листе изменений.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/** Карточка раздела с замечаниями: статусы, ответы и переходы жизненного цикла. */
function SectionCard({
  sectionId,
  comments,
  packageVersion,
  actor,
  canAdd,
  canParticipate,
  onAdd,
  onStatus,
  onReply,
}: {
  sectionId: string;
  comments: SectionComment[];
  packageVersion: number;
  actor: ReviewActor;
  /** Новое замечание оставляет роль этапа (как и раньше). */
  canAdd: boolean;
  /** Ответы и переходы — любой с правом review; закрытие — автор или роль этапа. */
  canParticipate: boolean;
  onAdd: (severity: CommentSeverity, text: string) => Promise<boolean>;
  onStatus: (id: string, action: CommentAction) => Promise<boolean>;
  onReply: (id: string, text: string) => Promise<boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [severity, setSeverity] = useState<CommentSeverity>('remark');
  const [text, setText] = useState('');

  const unresolved = comments.filter((c) => !isCommentResolved(c));
  const worst: CommentSeverity | null = unresolved.some((c) => c.severity === 'blocker')
    ? 'blocker'
    : unresolved.some((c) => c.severity === 'remark')
      ? 'remark'
      : unresolved.length > 0
        ? 'suggestion'
        : null;

  async function submit() {
    if (!text.trim()) return;
    if (await onAdd(severity, text.trim())) {
      setText('');
      setIsAdding(false);
    }
  }

  return (
    <div className="card-flat space-y-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-nord-6">
          {sectionId}
        </span>
        {worst && (
          <span
            className={
              worst === 'blocker' ? 'chip-block' : worst === 'remark' ? 'chip-warn' : 'chip-muted'
            }
          >
            {unresolved.length} {COMMENT_SEVERITY_LABELS[worst]}
            {unresolved.length > 1 ? 'а' : ''}
          </span>
        )}
      </div>

      {comments.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          packageVersion={packageVersion}
          actor={actor}
          canParticipate={canParticipate}
          onStatus={onStatus}
          onReply={onReply}
        />
      ))}

      {canAdd &&
        (isAdding ? (
          <div className="space-y-1.5">
            <div className="flex gap-1">
              {(['blocker', 'remark', 'suggestion'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${
                    severity === s
                      ? 'bg-slate-900 text-white dark:bg-nord-frost4'
                      : 'bg-slate-100 text-slate-500 dark:bg-nord-1 dark:text-nord-4'
                  }`}
                >
                  {COMMENT_SEVERITY_LABELS[s]}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Текст замечания"
              className="input py-1.5! text-[11px]!"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={submit}
                className="btn-primary px-2.5! py-1! text-[10px]!"
              >
                Добавить
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="btn-ghost px-2.5! py-1! text-[10px]!"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="text-[11px] font-bold text-brand-700 hover:underline dark:text-nord-frost2"
          >
            + Комментарий
          </button>
        ))}
    </div>
  );
}

/** Одно замечание: статус, происхождение, ответы и доступные действия. */
function CommentItem({
  comment: c,
  packageVersion,
  actor,
  canParticipate,
  onStatus,
  onReply,
}: {
  comment: SectionComment;
  packageVersion: number;
  actor: ReviewActor;
  canParticipate: boolean;
  onStatus: (id: string, action: CommentAction) => Promise<boolean>;
  onReply: (id: string, text: string) => Promise<boolean>;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  const status: CommentStatus = c.status ?? 'open';
  const fromVersion = c.packageVersion ?? packageVersion;
  const canAct = canParticipate && !c.legacy;
  const subject = {
    status,
    stage: c.stage ?? ('tw' as const),
    author: c.author,
    authorId: c.authorId ?? null,
    packageVersion: fromVersion,
    legacy: c.migrated,
  };
  const canResolve = canAct && canResolveComment(subject, actor);
  // «Исправлено» ставится только в более новой версии, чем та, к которой
  // замечание оставлено: выпущенный комплект не меняется.
  const canFix =
    canAct &&
    status === 'open' &&
    fromVersion < packageVersion &&
    canMarkCommentFixed(subject, actor);

  async function run(action: CommentAction) {
    setBusy(true);
    await onStatus(c.id, action);
    setBusy(false);
  }

  async function sendReply() {
    if (!replyText.trim()) return;
    setBusy(true);
    if (await onReply(c.id, replyText.trim())) {
      setReplyText('');
      setReplying(false);
    }
    setBusy(false);
  }

  const resolved = isCommentResolved(c);

  return (
    <div
      className={`space-y-1 rounded-lg px-2.5 py-1.5 ${
        resolved ? 'bg-slate-50/60 opacity-70 dark:bg-nord-1/60' : 'bg-slate-50 dark:bg-nord-1'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className={STATUS_CHIP[status]}>{COMMENT_STATUS_LABELS[status]}</span>
        {fromVersion !== packageVersion && <span className="chip-muted">из v{fromVersion}</span>}
        {c.fixedInVersion != null && (
          <span className="chip-muted">исправлено в v{c.fixedInVersion}</span>
        )}
        {c.legacy && <span className="chip-muted">старый формат</span>}
      </div>
      <p className="min-w-0 text-[11px] leading-relaxed text-slate-700 dark:text-nord-4">
        <span className={`font-extrabold ${SEVERITY_TONE[c.severity]}`}>
          {COMMENT_SEVERITY_LABELS[c.severity]}
        </span>{' '}
        {c.text}
        <span className="text-slate-400 dark:text-nord-muted">
          {' '}
          — {c.author}, {new Date(c.createdAt).toLocaleDateString('ru-RU')}
        </span>
      </p>
      {(c.fixedBy || c.verifiedBy) && (
        <p className="text-[10px] text-slate-400 dark:text-nord-muted">
          {c.fixedBy && <>исправил {c.fixedBy}</>}
          {c.fixedBy && c.verifiedBy && ' · '}
          {c.verifiedBy && <>проверил {c.verifiedBy}</>}
        </p>
      )}

      {(c.replies ?? []).length > 0 && (
        <div className="space-y-0.5 border-l-2 border-slate-200 pl-2 dark:border-nord-3">
          {(c.replies ?? []).map((r) => (
            <p key={r.id} className="text-[10px] leading-relaxed text-slate-600 dark:text-nord-4">
              {r.text}
              <span className="text-slate-400 dark:text-nord-muted">
                {' '}
                — {r.author}, {new Date(r.createdAt).toLocaleDateString('ru-RU')}
              </span>
            </p>
          ))}
        </div>
      )}

      {canAct && (
        <div className="flex flex-wrap gap-2 pt-0.5 text-[10px] font-bold">
          {canFix && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run('fix')}
              className="text-brand-700 hover:underline dark:text-nord-frost2"
            >
              Исправлено в v{packageVersion}
            </button>
          )}
          {canResolve && status === 'fixed' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => run('verify')}
                className="text-emerald-700 hover:underline dark:text-nord-green"
              >
                Проверено
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run('reopen')}
                className="text-amber-700 hover:underline dark:text-nord-yellow"
              >
                Не исправлено
              </button>
            </>
          )}
          {canResolve && (status === 'open' || status === 'fixed') && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run('reject')}
              className="text-slate-500 hover:underline dark:text-nord-muted"
            >
              Отклонить
            </button>
          )}
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="text-slate-500 hover:underline dark:text-nord-muted"
          >
            Ответить
          </button>
        </div>
      )}

      {replying && (
        <div className="space-y-1">
          <textarea
            rows={2}
            autoFocus
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Ответ: что исправлено или почему замечание неприменимо"
            className="input py-1.5! text-[11px]!"
          />
          <button
            type="button"
            disabled={busy}
            onClick={sendReply}
            className="btn-primary px-2.5! py-1! text-[10px]!"
          >
            Отправить
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Ответственные по этапам: исполнитель, срок и замещающий. Назначение — это
 * ответственность, а не право подписи: вердикт выносит роль этапа.
 */
function AssignmentsCard({
  assignments,
  currentStage,
  canAssignStages,
  candidates,
  onAssign,
}: {
  assignments: SerializedAssignment[];
  currentStage: ReviewStage;
  canAssignStages: AssignableStage[];
  candidates: Partial<Record<AssignableStage, AssignCandidate[]>>;
  onAssign: (
    stage: AssignableStage,
    input: { assigneeId: string; deputyId: string; dueAt: string },
  ) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<AssignableStage | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [deputyId, setDeputyId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);

  function startEdit(stage: AssignableStage) {
    const current = assignments.find((a) => a.stage === stage);
    setEditing(stage);
    setAssigneeId(current?.assigneeId ?? '');
    setDeputyId(current?.deputyId ?? '');
    setDueAt(current ? current.dueAt.slice(0, 10) : '');
  }

  async function save() {
    if (!editing || !assigneeId || !dueAt) return;
    setBusy(true);
    // Срок — конец выбранного дня по местному времени.
    const due = new Date(`${dueAt}T23:59:59`).toISOString();
    if (await onAssign(editing, { assigneeId, deputyId, dueAt: due })) setEditing(null);
    setBusy(false);
  }

  const options = editing ? (candidates[editing] ?? []) : [];
  const assignee = options.find((u) => u.id === assigneeId);
  const deputyOptions = options.filter((u) => u.id !== assigneeId && u.role === assignee?.role);

  return (
    <div className="card-flat space-y-2 p-3.5">
      <div className="text-xs font-extrabold text-slate-900 dark:text-nord-6">Ответственные</div>
      {(['tw', 'gap'] as const).map((stage) => {
        const a = assignments.find((x) => x.stage === stage);
        const overdue = a && currentStage === stage && isAssignmentOverdue(a.dueAt);
        return (
          <div key={stage} className="space-y-0.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-semibold ${
                  currentStage === stage
                    ? 'text-brand-700 dark:text-nord-frost2'
                    : 'text-slate-500 dark:text-nord-muted'
                }`}
              >
                {REVIEW_STAGE_LABELS[stage]}
              </span>
              {canAssignStages.includes(stage) && editing !== stage && (
                <button
                  type="button"
                  onClick={() => startEdit(stage)}
                  className="text-[10px] font-bold text-brand-700 hover:underline dark:text-nord-frost2"
                >
                  {a ? 'Переназначить' : 'Назначить'}
                </button>
              )}
            </div>
            {a ? (
              <div className="text-slate-600 dark:text-nord-4">
                {a.assigneeName}
                {a.deputyName && (
                  <span className="text-slate-400 dark:text-nord-muted">
                    {' '}
                    (зам.: {a.deputyName})
                  </span>
                )}
                <span
                  className={
                    overdue
                      ? 'ml-1 chip-block'
                      : 'ml-1 text-[10px] text-slate-400 dark:text-nord-muted'
                  }
                >
                  {overdue ? 'просрочено: ' : 'до '}
                  {new Date(a.dueAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
            ) : (
              <div className="text-slate-400 dark:text-nord-muted">не назначен</div>
            )}

            {editing === stage && (
              <div className="space-y-1.5 pt-1">
                <select
                  value={assigneeId}
                  onChange={(e) => {
                    setAssigneeId(e.target.value);
                    setDeputyId('');
                  }}
                  className="input py-1! text-[11px]!"
                >
                  <option value="">Исполнитель…</option>
                  {options.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.role})
                    </option>
                  ))}
                </select>
                <select
                  value={deputyId}
                  onChange={(e) => setDeputyId(e.target.value)}
                  disabled={!assignee}
                  className="input py-1! text-[11px]!"
                >
                  <option value="">Без замещающего</option>
                  {deputyOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="input py-1! text-[11px]!"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={busy || !assigneeId || !dueAt}
                    onClick={save}
                    className="btn-primary px-2.5! py-1! text-[10px]!"
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="btn-ghost px-2.5! py-1! text-[10px]!"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[10px] leading-relaxed text-slate-400 dark:text-nord-muted">
        Назначение задаёт ответственного и срок, но не право подписи: решение выносит роль этапа.
      </p>
    </div>
  );
}
