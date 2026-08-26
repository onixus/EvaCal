'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeJsonParse } from '@/lib/json';
import type { GostWizardSnapshot } from '@/lib/project';

export interface SerializedReviewPackage {
  id: string;
  name: string;
  version: number;
  status: string;
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
}

export default function PackageReviewClient({
  pkg,
  shareToken,
  isStaff,
}: {
  pkg: SerializedReviewPackage;
  shareToken: string | null;
  isStaff: boolean;
}) {
  const router = useRouter();
  const [reviewerName, setReviewerName] = useState('');
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const docTypes = safeJsonParse<string[]>(pkg.documentTypes, ['tz']);
  const requirements = (
    Array.isArray(pkg.snapshot.requirements) ? pkg.snapshot.requirements : []
  ) as Array<{ id?: string; originalText?: string; category?: string; status?: string }>;

  const downloadUrl = `/api/gost34/packages/${pkg.id}/artifact${
    shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''
  }`;

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    setIsSubmitting(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (shareToken) {
        headers['x-share-token'] = shareToken;
      }

      const postUrl = `/api/gost34/packages/${pkg.id}/review${
        shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''
      }`;
      const res = await fetch(postUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision,
          comment,
          reviewerName: reviewerName.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось отправить решение по согласованию');
      }

      setSubmitSuccess(
        decision === 'approve'
          ? 'Комплект документов успешно утверждён!'
          : 'Выпуск отклонён с указанием замечаний.',
      );
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при отправке');
    } finally {
      setIsSubmitting(false);
    }
  }

  const getStatusBadge = () => {
    switch (pkg.status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ УТВЕРЖДЁН
          </span>
        );
      case 'under_review':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            ⏳ НА СОГЛАСОВАНИИ
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            ✕ ОТКЛОНЁН
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-nord-1 dark:text-nord-4">
            📝 ЧЕРНОВИК
          </span>
        );
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6 px-4">
      {/* Hero Header */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-6 dark:border-nord-3 dark:from-nord-1/40 dark:to-nord-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-brand-100 px-2 py-0.5 font-mono text-xs font-bold text-brand-800 dark:bg-nord-3 dark:text-nord-frost3">
                  ГОСТ 34
                </span>
                <span className="font-mono text-xs font-bold text-slate-500">v{pkg.version}</span>
                {getStatusBadge()}
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-nord-6">
                {pkg.name}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                <span>
                  Проект:{' '}
                  <strong className="text-slate-700 dark:text-nord-4">{pkg.projectName}</strong>
                </span>
                <span>•</span>
                <span>
                  Заказчик:{' '}
                  <strong className="text-slate-700 dark:text-nord-4">{pkg.customerName}</strong>
                </span>
                <span>•</span>
                <span>
                  Выпуск:{' '}
                  {new Date(pkg.releasedAt || pkg.createdAt).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>

            {pkg.hasArtifact && (
              <div>
                <a
                  href={downloadUrl}
                  download
                  className="btn-primary !py-2.5 !px-5 text-sm font-bold flex items-center gap-2 shadow-lg shadow-brand-500/20"
                >
                  <span>⬇</span>
                  <span>Скачать комплект (ZIP)</span>
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Checksum & Standards Bar */}
        <div className="bg-slate-50/70 dark:bg-nord-1/20 px-6 py-3 border-b border-slate-100 dark:border-nord-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-semibold">Профиль:</span>
            <span className="font-mono font-bold text-slate-700 dark:text-nord-4">
              {pkg.standardProfileId} ({pkg.standardProfileVersion})
            </span>
          </div>

          {pkg.checksum && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-semibold">SHA-256:</span>
              <span className="font-mono text-[11px] bg-white dark:bg-nord-0 px-2 py-0.5 rounded border border-slate-200 dark:border-nord-3">
                {pkg.checksum}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Grid: Document Set & Requirements */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Documents Included */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-nord-6">
            📑 Состав комплекта документов
          </h3>
          <div className="space-y-2">
            {docTypes.map((dt) => (
              <div
                key={dt}
                className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 dark:border-nord-3 dark:bg-nord-1/30"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">
                    {dt}
                  </span>
                  <span className="text-xs font-semibold text-slate-700 dark:text-nord-4">
                    {dt === 'tz'
                      ? 'Техническое задание'
                      : dt === 'pz'
                        ? 'Пояснительная записка'
                        : dt === 'af'
                          ? 'Описание функциональной структуры'
                          : dt === 'pmi'
                            ? 'Программа и методика испытаний'
                            : dt === 'spec'
                              ? 'Спецификация оборудования и ПО'
                              : dt.toUpperCase()}
                  </span>
                </div>
                <span className="text-[11px] text-emerald-600 font-bold">✓ В архиве</span>
              </div>
            ))}
          </div>

          {pkg.snapshot.signatures && (
            <div className="pt-3 border-t border-slate-100 dark:border-nord-3 space-y-1.5">
              <h4 className="text-xs font-bold text-slate-600 dark:text-nord-4">
                ✍️ Подписанты по ГОСТ 2.104
              </h4>
              <div className="text-[11px] text-slate-500 dark:text-nord-muted space-y-1">
                {pkg.snapshot.signatures.developer && (
                  <div>Разработал: {pkg.snapshot.signatures.developer}</div>
                )}
                {pkg.snapshot.signatures.checker && (
                  <div>Проверил: {pkg.snapshot.signatures.checker}</div>
                )}
                {pkg.snapshot.signatures.normControl && (
                  <div>Н.контр: {pkg.snapshot.signatures.normControl}</div>
                )}
                {pkg.snapshot.signatures.customerApprover && (
                  <div>От Заказчика: {pkg.snapshot.signatures.customerApprover}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Middle & Right Column: Requirements & Decisions */}
        <div className="md:col-span-2 space-y-6">
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-nord-6">
                📋 Нормативные требования выпуска ({requirements.length})
              </h3>
              <span className="text-xs text-slate-400">Снимок из мастера</span>
            </div>

            {requirements.length === 0 ? (
              <p className="text-xs text-slate-500 italic">
                Требования сформированы автоматически из профиля.
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {requirements.map((req, idx) => (
                  <div
                    key={req.id || idx}
                    className="p-3 rounded-lg border border-slate-100 bg-white text-xs dark:border-nord-3 dark:bg-nord-1"
                  >
                    <div className="font-semibold text-slate-800 dark:text-nord-5">
                      {req.originalText}
                    </div>
                    {req.category && (
                      <div className="mt-1 text-[10px] text-slate-400">
                        Категория:{' '}
                        <span className="font-medium text-slate-600 dark:text-nord-4">
                          {req.category}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Review Decision Box */}
          <div className="card p-6 space-y-4 border-2 border-brand-200 dark:border-nord-frost4/40">
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Согласование комплекта нормативной документации
            </h3>

            {pkg.status === 'approved' ? (
              <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>✓</span> Комплект утверждён и зафиксирован в реестре
                </div>
                <div className="text-xs">
                  Утвердил: <strong>{pkg.approvedBy || 'Заказчик'}</strong> • Дата:{' '}
                  {pkg.approvedAt ? new Date(pkg.approvedAt).toLocaleDateString('ru-RU') : 'Ранее'}
                </div>
                {pkg.reviewComment && (
                  <div className="text-xs italic mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                    «{pkg.reviewComment}»
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmitReview} className="space-y-4">
                {submitSuccess && (
                  <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {submitSuccess}
                  </div>
                )}

                {submitError && (
                  <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                    {submitError}
                  </div>
                )}

                <div>
                  <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                    ФИО и должность согласующего
                  </label>
                  <input
                    type="text"
                    required
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    placeholder="Иванов И.И., Руководитель проекта со стороны Заказчика"
                    className="input text-sm"
                  />
                </div>

                <div>
                  <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                    Решение
                  </label>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => setDecision('approve')}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        decision === 'approve'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-nord-3 dark:text-nord-4'
                      }`}
                    >
                      ✓ Утвердить комплект
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecision('reject')}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        decision === 'reject'
                          ? 'border-rose-500 bg-rose-50 text-rose-800 font-bold dark:bg-rose-950/40 dark:text-rose-300'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-nord-3 dark:text-nord-4'
                      }`}
                    >
                      ✕ Отклонить выпуск
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label text-xs font-bold text-slate-700 dark:text-nord-4">
                    Комментарий / протокол согласования
                  </label>
                  <textarea
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Опциональный комментарий или ссылка на протокол совещания"
                    className="input text-sm"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`btn w-full text-sm font-bold ${
                      decision === 'approve'
                        ? 'btn-primary'
                        : 'bg-rose-600 hover:bg-rose-700 text-white'
                    }`}
                  >
                    {isSubmitting
                      ? 'Отправка...'
                      : decision === 'approve'
                        ? 'Утвердить выпуск документов'
                        : 'Отклонить с замечаниями'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
