'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SerializedGostPackage } from './types';
import {
  COMMENT_SEVERITY_LABELS,
  COMMENT_STATUS_LABELS,
  isCommentResolved,
  REVIEW_STAGE_LABELS,
  type SectionComment,
} from '@/lib/gost34/review/types';
import type { SerializedAssignment } from '@/lib/review/store';
import { isAssignmentOverdue } from '@/lib/review/workflow';

interface ReviewContext {
  comments: SectionComment[];
  assignments: SerializedAssignment[];
}

export default function PackageReviewModal({
  pkg,
  initialDecision,
  onClose,
}: {
  pkg: SerializedGostPackage;
  initialDecision: 'approve' | 'reject';
  onClose: () => void;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<'approve' | 'reject'>(initialDecision);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<ReviewContext | null>(null);

  // Ответственный, срок и незакрытые замечания (#103) — чтобы решение
  // принималось с видом на то, что ещё не проверено.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/gost34/packages/${pkg.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.package) return;
        setContext({
          comments: data.package.reviewComments ?? [],
          assignments: data.package.reviewAssignments ?? [],
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pkg.id]);

  const stage = pkg.reviewStage === 'gap' ? 'gap' : 'tw';
  const assignment = context?.assignments.find((a) => a.stage === stage) ?? null;
  const unresolved = (context?.comments ?? []).filter((c) => !isCommentResolved(c));
  const openBlockers = unresolved.filter((c) => c.severity === 'blocker');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/gost34/packages/${pkg.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось отправить согласование');
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при согласовании');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="card w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
              {decision === 'approve' ? 'Утверждение комплекта' : 'Отклонение комплекта'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              {pkg.name} (v{pkg.version})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </div>
          )}
          <div className="space-y-1.5 rounded-lg border border-slate-200 p-3 text-xs dark:border-nord-3">
            <div className="font-bold text-slate-700 dark:text-nord-4">
              {REVIEW_STAGE_LABELS[stage]}
            </div>
            {assignment ? (
              <div className="text-slate-600 dark:text-nord-4">
                Ответственный: {assignment.assigneeName}
                {assignment.deputyName && ` · замещает ${assignment.deputyName}`} ·{' '}
                <span
                  className={
                    isAssignmentOverdue(assignment.dueAt)
                      ? 'font-bold text-rose-700 dark:text-nord-redText'
                      : undefined
                  }
                >
                  срок {new Date(assignment.dueAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
            ) : (
              <div className="text-slate-400 dark:text-nord-muted">
                {context ? 'Ответственный не назначен' : 'Загрузка…'}
              </div>
            )}
            {unresolved.length > 0 && (
              <ul className="space-y-1">
                {unresolved.slice(0, 5).map((c) => (
                  <li key={c.id} className="text-slate-600 dark:text-nord-4">
                    <span className="font-semibold">
                      {COMMENT_SEVERITY_LABELS[c.severity]} ·{' '}
                      {COMMENT_STATUS_LABELS[c.status ?? 'open']}
                    </span>{' '}
                    {c.sectionId}: {c.text}
                    {(c.replies?.length ?? 0) > 0 && (
                      <span className="text-slate-400 dark:text-nord-muted">
                        {' '}
                        (ответов: {c.replies?.length})
                      </span>
                    )}
                  </li>
                ))}
                {unresolved.length > 5 && (
                  <li className="text-slate-400 dark:text-nord-muted">
                    и ещё {unresolved.length - 5}
                  </li>
                )}
              </ul>
            )}
            {decision === 'approve' && openBlockers.length > 0 && (
              <div className="text-rose-700 dark:text-nord-redText">
                Незакрытых блокеров: {openBlockers.length}. Исправленный блокер нужно проверить до
                утверждения.
              </div>
            )}
          </div>
          <div>
            <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
              Решение
            </label>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <button
                type="button"
                onClick={() => setDecision('approve')}
                className={`p-3 rounded-xl border text-center transition-all ${decision === 'approve' ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-nord-3 dark:text-nord-4'}`}
              >
                Согласовать (Approve)
              </button>
              <button
                type="button"
                onClick={() => setDecision('reject')}
                className={`p-3 rounded-xl border text-center transition-all ${decision === 'reject' ? 'border-rose-500 bg-rose-50 text-rose-800 font-bold dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-nord-3 dark:text-nord-4'}`}
              >
                Отклонить (Reject)
              </button>
            </div>
          </div>
          <div>
            <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
              Комментарий / замечания
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                decision === 'approve'
                  ? 'Опциональный комментарий к согласованию (например, Утверждено на рабочей группе)'
                  : 'Укажите причину отклонения выпуска'
              }
              className="input text-sm"
            />
          </div>
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-nord-3">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`btn text-xs font-bold ${decision === 'approve' ? 'btn-primary' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
            >
              {submitting ? 'Отправка...' : 'Подтвердить решение'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
