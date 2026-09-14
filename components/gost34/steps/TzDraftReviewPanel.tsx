'use client';

import React, { useState, useEffect } from 'react';
import type { TzSectionProposal, LlmDraftFlag } from '@/lib/gost34/llm/tzAuthor/types';
import { isHardFlag } from '@/lib/gost34/llm/tzAuthor/flags';

interface TzDraftReviewPanelProps {
  nodeId: string;
  schemaTitle: string;
  baselineParagraphs: string[];
  proposal?: TzSectionProposal;
  isGenerating?: boolean;
  onGenerateDraft: (speculate: boolean) => Promise<void>;
  onAccept: (paragraphs: string[], isEdited: boolean) => Promise<void>;
  onReset: () => Promise<void>;
  disabled?: boolean;
}

export default function TzDraftReviewPanel({
  nodeId,
  schemaTitle,
  baselineParagraphs,
  proposal,
  isGenerating = false,
  onGenerateDraft,
  onAccept,
  onReset,
  disabled = false,
}: TzDraftReviewPanelProps) {
  const [speculate, setSpeculate] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync editText when proposal changes
  useEffect(() => {
    if (proposal?.paragraphs) {
      setEditText(proposal.paragraphs.join('\n\n'));
    } else {
      setEditText('');
    }
  }, [proposal?.paragraphs]);

  const flags: LlmDraftFlag[] = proposal?.flags || [];
  const hardFlags = flags.filter(isHardFlag);
  const hasHard = hardFlags.length > 0;

  const handleGenerate = async () => {
    setActionError(null);
    try {
      await onGenerateDraft(speculate);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Ошибка при формировании черновика');
    }
  };

  const handleAccept = async () => {
    setActionError(null);
    setIsSubmitting(true);
    try {
      if (isEditing) {
        const paragraphs = editText
          .split('\n\n')
          .map((p) => p.trim())
          .filter(Boolean);
        await onAccept(paragraphs, true);
        setIsEditing(false);
      } else {
        await onAccept(proposal?.paragraphs || [], false);
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Ошибка при принятии черновика');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async () => {
    setActionError(null);
    setIsSubmitting(true);
    try {
      await onReset();
      setIsEditing(false);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Ошибка при сбросе черновика');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Case 1: No proposal yet, or rejected and not editing
  if (!proposal || (proposal.status === 'REJECTED' && !isGenerating)) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3.5 dark:border-nord-blue/30 dark:bg-nord-blue/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base">✨</span>
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-nord-5">
                {proposal?.status === 'REJECTED'
                  ? 'Черновик сброшен к схеме'
                  : 'Черновик ИИ не сформирован'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-nord-muted">
                Сформируйте контекстно-обоснованный текст раздела на основе требований и опросника
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-nord-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={speculate}
                onChange={(e) => setSpeculate(e.target.checked)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-nord-3 dark:bg-nord-1"
                disabled={disabled || isGenerating}
              />
              <span title="Разрешить модели делать предположения при недостатке контекста">
                Допускать гипотезы (speculate)
              </span>
            </label>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={disabled || isGenerating}
              className="btn-secondary !py-1 !px-3 text-xs flex items-center gap-1.5 font-semibold text-brand-700 border-brand-300 bg-white hover:bg-brand-50 dark:border-brand-500/40 dark:bg-nord-2 dark:text-brand-300 dark:hover:bg-nord-3"
            >
              {isGenerating ? (
                <>
                  <span className="animate-spin text-xs">⏳</span>
                  <span>Генерация…</span>
                </>
              ) : (
                <>
                  <span>✨</span>
                  <span>
                    {proposal?.status === 'REJECTED'
                      ? 'Сформировать заново'
                      : 'Сформировать черновик'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {actionError && (
          <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded p-2">
            {actionError}
          </div>
        )}
      </div>
    );
  }

  // Case 2: Generating in progress
  if (isGenerating) {
    return (
      <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 text-center dark:border-nord-blue/30 dark:bg-nord-blue/10">
        <div className="inline-flex items-center gap-2 text-xs text-brand-700 dark:text-brand-300 font-medium">
          <span className="animate-spin">⏳</span>
          <span>ИИ формирует черновик раздела «{schemaTitle}»…</span>
        </div>
      </div>
    );
  }

  // Case 3: Proposal exists (PROPOSED, ACCEPTED, ACCEPTED_EDITED)
  const isAccepted = proposal.status === 'ACCEPTED' || proposal.status === 'ACCEPTED_EDITED';

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 dark:border-nord-3 dark:bg-nord-1">
      {/* Header bar with badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-nord-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-800 dark:text-nord-5">
            Ревью черновика ИИ
          </span>
          {proposal.status === 'PROPOSED' && (
            <span className="chip-warn text-[10px] font-bold">черновик (ожидает ревью)</span>
          )}
          {proposal.status === 'ACCEPTED' && (
            <span className="chip-ok text-[10px] font-bold">принят ИИ</span>
          )}
          {proposal.status === 'ACCEPTED_EDITED' && (
            <span className="chip-ok text-[10px] font-bold">принят с правкой</span>
          )}
          {proposal.speculate && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300 font-mono">
              гипотезы вкл.
            </span>
          )}
          {!proposal.usedLlm && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 dark:bg-nord-2 dark:text-nord-4 font-mono">
              схема (гэпы)
            </span>
          )}
        </div>

        {proposal.provenance && (
          <div className="text-[10px] text-slate-500 dark:text-nord-muted font-mono">
            {proposal.provenance.providerId}/{proposal.provenance.model}
            {proposal.provenance.latencyMs ? ` · ${proposal.provenance.latencyMs}мс` : ''}
          </div>
        )}
      </div>

      {/* Error alert */}
      {actionError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {actionError}
        </div>
      )}

      {/* Questions regarding gaps */}
      {proposal.questions && proposal.questions.length > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs space-y-1.5 dark:border-sky-800/40 dark:bg-sky-950/20">
          <div className="font-semibold text-sky-900 dark:text-sky-300 flex items-center gap-1.5">
            <span>❓</span>
            <span>Вопросы для архитектора по недостающим сведениям:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-sky-800 dark:text-sky-200 pl-1 text-[11px] leading-relaxed">
            {proposal.questions.map((q, qIdx) => (
              <li key={qIdx}>{q.question}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Fact-diff Flags */}
      {flags.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs space-y-2 dark:border-nord-3 dark:bg-nord-2">
          <div className="font-bold text-slate-800 dark:text-nord-6 flex items-center gap-1.5">
            <span>Замечания валидатора расхождений ({flags.length}):</span>
          </div>
          <div className="space-y-1.5">
            {flags.map((flag, fIdx) => (
              <div
                key={fIdx}
                className={`p-2 rounded border text-xs flex items-start gap-2 ${
                  flag.severity === 'block'
                    ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-nord-red/40 dark:bg-nord-red/10 dark:text-nord-redText'
                    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-nord-yellow'
                }`}
              >
                <span className="font-bold shrink-0">
                  {flag.severity === 'block' ? '🛑 [БЛОКЕР]' : '⚠️ [ПРЕДУПРЕЖДЕНИЕ]'}
                </span>
                <div className="min-w-0">
                  <div className="font-medium">{flag.detail}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">
                    Фрагмент: «{flag.span}»
                    {flag.baselineSpan ? ` (в схеме: «${flag.baselineSpan}»)` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasHard && (
            <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 pt-1">
              ⚠️ Принятие заблокировано: обнаружены критические замечания. Исправьте текст раздела,
              чтобы исключить неподтверждённые нормативы, снятые ограничения или несанкционированные
              числа.
            </div>
          )}
        </div>
      )}

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Baseline */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-nord-3 dark:bg-nord-1 space-y-2">
          <div className="text-xs font-bold text-slate-600 dark:text-nord-muted uppercase tracking-wider">
            Базовый текст (схема ГОСТ 34)
          </div>
          <div className="text-xs text-slate-700 dark:text-nord-4 space-y-2 leading-relaxed max-h-[300px] overflow-y-auto">
            {baselineParagraphs && baselineParagraphs.length > 0 ? (
              baselineParagraphs.map((p, idx) => (
                <p key={idx} className="text-justify">
                  {p}
                </p>
              ))
            ) : (
              <p className="italic text-slate-400 dark:text-nord-muted">
                В базовой схеме текст отсутствует
              </p>
            )}
          </div>
        </div>

        {/* Right: Proposal / Editor */}
        <div className="rounded-lg border border-brand-200 bg-white p-3 dark:border-brand-500/40 dark:bg-nord-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-brand-700 dark:text-brand-400 uppercase tracking-wider">
              {isEditing ? 'Правка черновика' : 'Черновик ИИ'}
            </div>
            {!isEditing && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 hover:underline font-semibold"
                disabled={disabled}
              >
                Редактировать
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={8}
                className="input text-xs font-sans leading-relaxed w-full font-normal"
                placeholder="Текст абзацев (разделяйте пустой строкой)..."
                disabled={disabled || isSubmitting}
              />
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Разделяйте абзацы двойным переводом строки</span>
                <span>Символов: {editText.length}</span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-800 dark:text-nord-5 space-y-2 leading-relaxed max-h-[300px] overflow-y-auto">
              {proposal.paragraphs && proposal.paragraphs.length > 0 ? (
                proposal.paragraphs.map((p, idx) => (
                  <p key={idx} className="text-justify">
                    {p}
                  </p>
                ))
              ) : (
                <p className="italic text-slate-400 dark:text-nord-muted">Черновик пуст</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-nord-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={disabled || isSubmitting}
            className="btn-secondary text-xs !py-1 !px-2.5 text-rose-700 border-rose-200 hover:bg-rose-50 dark:border-nord-red/40 dark:text-nord-redText dark:hover:bg-nord-red/10"
            title="Сбросить раздел к базовому тексту схемы"
          >
            Сбросить к схеме
          </button>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={disabled || isGenerating || isSubmitting}
            className="btn-ghost text-xs !py-1 !px-2.5 text-slate-600 hover:text-slate-900 dark:text-nord-4"
            title="Перегенерировать черновик модели"
          >
            Перегенерировать
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setEditText(proposal.paragraphs.join('\n\n'));
                }}
                disabled={disabled || isSubmitting}
                className="btn-secondary text-xs !py-1 !px-2.5"
              >
                Отмена
              </button>

              <button
                type="button"
                onClick={handleAccept}
                disabled={disabled || isSubmitting}
                className="btn-primary text-xs !py-1 !px-3 font-semibold"
              >
                {isSubmitting ? 'Сохранение…' : 'Принять с правкой'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleAccept}
              disabled={disabled || hasHard || isSubmitting}
              className="btn-primary text-xs !py-1 !px-4 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                hasHard
                  ? 'Принятие заблокировано: устраните критические замечания'
                  : 'Принять черновик ИИ в проект'
              }
            >
              {isSubmitting ? 'Сохранение…' : isAccepted ? 'Принят (обновить)' : 'Принять'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
