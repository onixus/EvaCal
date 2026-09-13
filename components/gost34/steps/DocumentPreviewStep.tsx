'use client';

import { useState, useEffect, useMemo } from 'react';
import type { WizardStepProps } from '../wizardShared';
import type { Gost34DocumentAST, Gost34Section, Gost34TableData } from '@/lib/gost34/types';
import type { SectionComment } from '@/lib/gost34/review/types';
import { type TzAuthorState, TZ_AUTHOR_PROMPT_VERSION } from '@/lib/gost34/llm/tzAuthor/types';
import { useLlmProvider } from '../hooks/useLlmProvider';
import LlmSettingsPanel from './requirements/LlmSettingsPanel';
import TzDraftReviewPanel from './TzDraftReviewPanel';
import { useTzAuthorBatch } from '../hooks/useTzAuthorBatch';
import { getShareToken, withShareHeaders } from '@/lib/shareClient';

interface DocumentPreviewStepProps extends WizardStepProps {
  calculationId: string;
  onUpdateSectionOverrides: (
    overrides: Record<string, { title?: string; paragraphs?: string[] }>,
  ) => void;
  onUpdateTzAuthor?: (tzAuthor: TzAuthorState) => void;
  reviewComments?: SectionComment[];
  selectedSectionAnchor?: string | null;
}

export default function DocumentPreviewStep({
  decisions,
  calculationId,
  onUpdateSectionOverrides,
  onUpdateTzAuthor,
  reviewComments,
  selectedSectionAnchor,
}: DocumentPreviewStepProps) {
  const [ast, setAst] = useState<Gost34DocumentAST | null>(null);
  const [baselineAst, setBaselineAst] = useState<Gost34DocumentAST | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSectionTitle, setActiveSectionTitle] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState<string | null>(null);
  const [editParagraphs, setEditParagraphs] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [generatingNodeId, setGeneratingNodeId] = useState<string | null>(null);
  const [isShare, setIsShare] = useState(false);

  // Check if session is a share session (read-only / external)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = getShareToken(calculationId);
      const shareParam = new URLSearchParams(window.location.search).get('share');
      setIsShare(Boolean(token || shareParam));
    }
  }, [calculationId]);

  const {
    showLlmSettings,
    setShowLlmSettings,
    llmProviders,
    llmProviderId,
    setLlmProviderId,
    llmSelectedModel,
    setLlmSelectedModel,
    llmAvailable,
    llmModels,
    llmError,
    tzAuthorEnabled,
    checkLlmStatus,
  } = useLlmProvider();

  const isTz = decisions.docType === 'TZ';
  const isLegacy =
    decisions.standardProfileId === 'legacy-gost34-602-89' ||
    decisions.standardProfileId === 'legacy';
  const canUseTzAuthor = isTz && !isLegacy && tzAuthorEnabled && !isShare;

  const sectionOverrides = useMemo(
    () => decisions.sectionOverrides || {},
    [decisions.sectionOverrides],
  );

  // Fetch AST preview
  useEffect(() => {
    let isCancelled = false;
    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/gost34/preview', {
          method: 'POST',
          headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            calculationId,
            docType: decisions.docType,
            rawRequirements: decisions.rawRequirements,
            standardProfileId: decisions.standardProfileId,
            applicabilityOverrides: decisions.applicabilityOverrides,
            manualLinks: decisions.manualLinks,
            sectionOverrides,
            tzAuthor: decisions.tzAuthor,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Не удалось сформировать предпросмотр документа');
        }

        const data = await res.json();
        if (!isCancelled) {
          setAst(data.ast);
          if (data.baselineAst) {
            setBaselineAst(data.baselineAst);
          }
          if (data.ast?.sections?.length > 0) {
            setActiveSectionTitle((prev) => prev || data.ast.sections[0].title);
          }
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Ошибка загрузки предпросмотра');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadPreview();
    return () => {
      isCancelled = true;
    };
  }, [
    calculationId,
    decisions.docType,
    decisions.rawRequirements,
    decisions.standardProfileId,
    decisions.applicabilityOverrides,
    decisions.manualLinks,
    sectionOverrides,
    decisions.tzAuthor,
  ]);

  // Flatten all sections and subsections for tree and search
  const flatSections = useMemo(() => {
    if (!ast?.sections) return [];
    const list: { section: Gost34Section; level: number; parentTitle?: string }[] = [];

    function traverse(sections: Gost34Section[], level: number, parentTitle?: string) {
      for (const s of sections) {
        list.push({ section: s, level, parentTitle });
        if (s.subsections && s.subsections.length > 0) {
          traverse(s.subsections, level + 1, s.title);
        }
      }
    }

    traverse(ast.sections, 1);
    return list;
  }, [ast]);

  // Filter sections by search
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return flatSections;
    const query = searchQuery.toLowerCase();
    return flatSections.filter(({ section }) => {
      const matchTitle = section.title.toLowerCase().includes(query);
      const matchParagraphs = (section.paragraphs || []).some((p) =>
        p.toLowerCase().includes(query),
      );
      return matchTitle || matchParagraphs;
    });
  }, [flatSections, searchQuery]);

  // Auto-scroll and open edit mode for selectedSectionAnchor
  useEffect(() => {
    if (!selectedSectionAnchor || flatSections.length === 0) return;
    const target = selectedSectionAnchor.trim().toLowerCase();
    const matched = flatSections.find((s) => {
      const titleLower = s.section.title.toLowerCase();
      return (
        titleLower === target ||
        titleLower.includes(target) ||
        target.includes(titleLower) ||
        (target.startsWith('3') && titleLower.startsWith('3')) ||
        (target.startsWith('4') && titleLower.startsWith('4')) ||
        (target.startsWith('6') && titleLower.startsWith('6'))
      );
    });
    if (matched) {
      setActiveSectionTitle(matched.section.title);
      startEditing(matched.section);
      setTimeout(() => {
        const el = document.getElementById(`sec-${encodeURIComponent(matched.section.title)}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('field-flash');
          setTimeout(() => el.classList.remove('field-flash'), 2100);
        }
      }, 100);
    }
  }, [selectedSectionAnchor, flatSections]);

  function isDraftableSection(sec: Gost34Section): boolean {
    return Boolean(
      canUseTzAuthor &&
        sec.id &&
        sec.id.startsWith('tz2020-') &&
        sec.id !== 'tz2020-goals' &&
        sec.id !== 'tz2020-requirements',
    );
  }

  const draftableNodes = useMemo(() => {
    return flatSections
      .map((s) => s.section)
      .filter((sec) => isDraftableSection(sec))
      .map((sec) => ({ id: sec.id, title: sec.title }));
  }, [flatSections, canUseTzAuthor]);

  const batch = useTzAuthorBatch({
    calculationId,
    providerId: llmProviderId,
    model: llmSelectedModel,
    rawRequirements: decisions.rawRequirements,
    applicabilityOverrides: decisions.applicabilityOverrides,
    manualLinks: decisions.manualLinks,
    standardProfileId: decisions.standardProfileId,
    tzAuthor: decisions.tzAuthor,
    onUpdateTzAuthor,
  });

  const unproposedDraftCount = useMemo(() => {
    const proposals = decisions.tzAuthor?.proposals || {};
    return draftableNodes.filter(
      (n) => !proposals[n.id] || proposals[n.id].status === 'REJECTED',
    ).length;
  }, [draftableNodes, decisions.tzAuthor]);

  const acceptedCount = useMemo(() => {
    const proposals = decisions.tzAuthor?.proposals || {};
    return Object.values(proposals).filter(
      (p) => p.status === 'ACCEPTED' || p.status === 'ACCEPTED_EDITED',
    ).length;
  }, [decisions.tzAuthor]);

  function findSectionById(
    sections: Gost34Section[] | undefined,
    id: string,
  ): Gost34Section | undefined {
    if (!sections) return undefined;
    for (const s of sections) {
      if (s.id === id) return s;
      if (s.subsections) {
        const found = findSectionById(s.subsections, id);
        if (found) return found;
      }
    }
    return undefined;
  }

  function getSectionBadge(sec: Gost34Section) {
    const proposal = decisions.tzAuthor?.proposals?.[sec.id];
    if (proposal) {
      if (proposal.status === 'PROPOSED') {
        return {
          type: 'proposed' as const,
          label: 'черновик',
          className: 'chip-warn text-[10px]',
          dotClass: 'bg-amber-400',
        };
      }
      if (proposal.status === 'ACCEPTED') {
        return {
          type: 'accepted' as const,
          label: 'принят ИИ',
          className: 'chip-ok text-[10px]',
          dotClass: 'bg-emerald-400',
        };
      }
      if (proposal.status === 'ACCEPTED_EDITED') {
        return {
          type: 'accepted_edited' as const,
          label: 'принят с правкой',
          className: 'chip-ok text-[10px]',
          dotClass: 'bg-teal-400',
        };
      }
    }
    const isOverridden = !!sectionOverrides[sec.title] || !!sectionOverrides[sec.id];
    if (isOverridden) {
      return {
        type: 'manual' as const,
        label: 'изменён вручную',
        className:
          'text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 dark:bg-nord-2 dark:text-nord-4 font-medium',
        dotClass: 'bg-slate-400',
      };
    }
    return null;
  }

  const handleGenerateDraft = async (nodeId: string, speculate: boolean) => {
    setGeneratingNodeId(nodeId);
    try {
      const res = await fetch('/api/gost34/draft-tz', {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          calculationId,
          nodeId,
          providerId: llmProviderId,
          model: llmSelectedModel,
          speculate,
          rawRequirements: decisions.rawRequirements,
          applicabilityOverrides: decisions.applicabilityOverrides,
          manualLinks: decisions.manualLinks,
          standardProfileId: decisions.standardProfileId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Не удалось сформировать черновик ИИ');
      }

      const data = await res.json();
      if (data.proposal) {
        const nextTzAuthor: TzAuthorState = {
          promptVersion: decisions.tzAuthor?.promptVersion || TZ_AUTHOR_PROMPT_VERSION,
          speculateDefault: false,
          proposals: {
            ...(decisions.tzAuthor?.proposals || {}),
            [nodeId]: data.proposal,
          },
        };
        onUpdateTzAuthor?.(nextTzAuthor);
      }
    } finally {
      setGeneratingNodeId(null);
    }
  };

  const handleAcceptDraft = async (
    nodeId: string,
    paragraphs: string[],
    isEdited: boolean,
  ) => {
    const existing = decisions.tzAuthor?.proposals?.[nodeId];
    const res = await fetch('/api/gost34/draft-tz/decision', {
      method: 'POST',
      headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        calculationId,
        nodeId,
        decision: isEdited ? 'accept_edited' : 'accept',
        paragraphs,
        speculate: existing?.speculate ?? false,
        rawRequirements: decisions.rawRequirements,
        applicabilityOverrides: decisions.applicabilityOverrides,
        manualLinks: decisions.manualLinks,
        standardProfileId: decisions.standardProfileId,
        provenance: existing?.provenance,
        usedLlm: existing?.usedLlm ?? true,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 409 && Array.isArray(errData.flags)) {
        const msgs = errData.flags.map((f: any) => f.message).join('; ');
        throw new Error(`Блокирующие флаги ИИ: ${msgs}`);
      }
      throw new Error(errData.error || 'Не удалось принять черновик');
    }

    const data = await res.json();
    if (data.proposal) {
      const nextTzAuthor: TzAuthorState = {
        promptVersion: decisions.tzAuthor?.promptVersion || TZ_AUTHOR_PROMPT_VERSION,
        speculateDefault: false,
        proposals: {
          ...(decisions.tzAuthor?.proposals || {}),
          [nodeId]: data.proposal,
        },
      };
      onUpdateTzAuthor?.(nextTzAuthor);
    }
  };

  const handleResetDraft = async (nodeId: string) => {
    const res = await fetch('/api/gost34/draft-tz/decision', {
      method: 'POST',
      headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        calculationId,
        nodeId,
        decision: 'reject',
        rawRequirements: decisions.rawRequirements,
        applicabilityOverrides: decisions.applicabilityOverrides,
        manualLinks: decisions.manualLinks,
        standardProfileId: decisions.standardProfileId,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Не удалось сбросить черновик');
    }

    const data = await res.json();

    // Удаляем ручные оверрайды для этого раздела, если они были
    const nextOverrides = { ...sectionOverrides };
    let overridesChanged = false;
    if (nextOverrides[nodeId]) {
      delete nextOverrides[nodeId];
      overridesChanged = true;
    }
    const sec = flatSections.find((s) => s.section.id === nodeId);
    if (sec && nextOverrides[sec.section.title]) {
      delete nextOverrides[sec.section.title];
      overridesChanged = true;
    }
    if (overridesChanged) {
      onUpdateSectionOverrides(nextOverrides);
    }

    if (data.proposal) {
      const nextTzAuthor: TzAuthorState = {
        promptVersion: decisions.tzAuthor?.promptVersion || TZ_AUTHOR_PROMPT_VERSION,
        speculateDefault: false,
        proposals: {
          ...(decisions.tzAuthor?.proposals || {}),
          [nodeId]: data.proposal,
        },
      };
      onUpdateTzAuthor?.(nextTzAuthor);
    }
  };

  function startEditing(sec: Gost34Section) {
    setEditingSectionTitle(sec.title);
    setEditParagraphs((sec.paragraphs || []).join('\n\n'));
  }

  function saveSectionEdit(title: string) {
    const parsedParagraphs = editParagraphs
      .split('\n\n')
      .map((p) => p.trim())
      .filter(Boolean);

    const updated = {
      ...sectionOverrides,
      [title]: {
        paragraphs: parsedParagraphs.length > 0 ? parsedParagraphs : undefined,
      },
    };

    onUpdateSectionOverrides(updated);
    setEditingSectionTitle(null);
  }

  function resetSectionEdit(title: string) {
    const updated = { ...sectionOverrides };
    delete updated[title];
    onUpdateSectionOverrides(updated);
    if (editingSectionTitle === title) {
      setEditingSectionTitle(null);
    }
  }

  function renderTable(table: Gost34TableData, idx: number) {
    return (
      <div
        key={idx}
        className="my-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-200 dark:border-nord-3"
      >
        {table.caption && (
          <div className="bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-600 dark:text-nord-4 border-b border-slate-200 dark:border-slate-200 dark:border-nord-3">
            {table.caption}
          </div>
        )}
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-500 dark:text-nord-muted">
              {table.headers.map((h, hIdx) => (
                <th
                  key={hIdx}
                  className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.rows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-slate-50/50 dark:hover:bg-nord-2">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3 py-2 text-slate-600 dark:text-nord-4">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSectionBlock(sec: Gost34Section, level: number = 1) {
    const isEditing = editingSectionTitle === sec.title;
    const badge = getSectionBadge(sec);

    const titleLower = sec.title.toLowerCase();
    const sectionReviewComments = (reviewComments || []).filter((c) => {
      const cLower = c.sectionId.toLowerCase();
      return (
        cLower === titleLower ||
        titleLower.includes(cLower) ||
        cLower.includes(titleLower) ||
        (cLower.startsWith('3') && titleLower.startsWith('3')) ||
        (cLower.startsWith('4') && titleLower.startsWith('4')) ||
        (cLower.startsWith('6') && titleLower.startsWith('6'))
      );
    });

    const hasComments = sectionReviewComments.length > 0;

    return (
      <div
        key={sec.title}
        id={`sec-${encodeURIComponent(sec.title)}`}
        className={`p-4 rounded-xl border transition-all ${
          activeSectionTitle === sec.title
            ? 'border-brand-500 bg-brand-50/10 dark:border-brand-500/80'
            : hasComments
              ? 'border-rose-300 bg-rose-50/20 dark:border-nord-red/40 dark:bg-nord-red/5'
              : 'border-slate-200/80 dark:border-slate-200 dark:border-nord-3 bg-white dark:bg-nord-dark'
        }`}
      >
        {/* Замечания ревьювера к разделу */}
        {hasComments && (
          <div className="mb-3 space-y-1.5 rounded-lg border border-rose-200 bg-rose-50/80 p-2.5 dark:border-nord-red/40 dark:bg-nord-red/10">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-rose-900 dark:text-nord-redText">
              <span>⚠️</span>
              <span>Замечания ревьювера к разделу «{sec.title}» ({sectionReviewComments.length}):</span>
            </div>
            <div className="space-y-1">
              {sectionReviewComments.map((c) => (
                <div key={c.id} className="flex flex-wrap items-start gap-1.5 text-xs">
                  <span
                    className={
                      c.severity === 'blocker'
                        ? 'chip-block'
                        : c.severity === 'remark'
                          ? 'chip-warn'
                          : 'chip-muted'
                    }
                  >
                    {c.severity === 'blocker'
                      ? 'блокер'
                      : c.severity === 'remark'
                        ? 'замечание'
                        : 'предложение'}
                  </span>
                  <span className="font-medium text-slate-800 dark:text-nord-5 leading-relaxed">
                    {c.text}
                  </span>
                  {c.author && (
                    <span className="ml-auto text-[10px] text-slate-400 dark:text-nord-muted">
                      {c.author}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-200 dark:border-nord-3 pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <h4
              className={`font-semibold text-slate-900 dark:text-slate-900 dark:text-nord-6 ${
                level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-xs'
              }`}
            >
              {sec.title}
            </h4>
            {badge && <span className={badge.className}>{badge.label}</span>}
            {hasComments && (
              <span className="chip-block text-[10px]">
                требует правок
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => saveSectionEdit(sec.title)}
                  className="btn-primary text-xs !px-2.5 !py-1"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => setEditingSectionTitle(null)}
                  className="btn-secondary text-xs !px-2.5 !py-1"
                >
                  Отмена
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEditing(sec)}
                  className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 hover:underline px-1.5 py-0.5"
                >
                  Редактировать
                </button>
                {badge?.type === 'manual' && (
                  <button
                    type="button"
                    onClick={() => resetSectionEdit(sec.title)}
                    className="text-xs text-rose-500 hover:text-rose-600 dark:text-rose-400 hover:underline px-1.5 py-0.5"
                  >
                    Сбросить
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-500 dark:text-nord-muted mb-1">
                Содержимое раздела (абзацы текста / пункты требований, разделяйте пустой строкой):
              </label>
              <textarea
                value={editParagraphs}
                onChange={(e) => setEditParagraphs(e.target.value)}
                rows={6}
                className="input text-xs font-sans leading-relaxed w-full font-normal"
                placeholder="Текст абзацев раздела..."
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-xs text-slate-700 dark:text-slate-600 dark:text-nord-4 leading-relaxed">
            {sec.paragraphs &&
              sec.paragraphs.map((p, pIdx) => (
                <p key={pIdx} className="text-justify">
                  {p}
                </p>
              ))}

            {sec.tables && sec.tables.map((tbl, tIdx) => renderTable(tbl, tIdx))}

            {/* Панель ревью черновика ИИ */}
            {isDraftableSection(sec) && (
              <TzDraftReviewPanel
                nodeId={sec.id}
                schemaTitle={sec.title}
                baselineParagraphs={
                  findSectionById(baselineAst?.sections, sec.id)?.paragraphs ||
                  sec.paragraphs ||
                  []
                }
                proposal={decisions.tzAuthor?.proposals?.[sec.id]}
                isGenerating={generatingNodeId === sec.id}
                onGenerateDraft={(speculate) => handleGenerateDraft(sec.id, speculate)}
                onAccept={(paragraphs, isEdited) =>
                  handleAcceptDraft(sec.id, paragraphs, isEdited)
                }
                onReset={() => handleResetDraft(sec.id)}
                disabled={batch.isRunning || (generatingNodeId !== null && generatingNodeId !== sec.id)}
              />
            )}

            {sec.subsections && sec.subsections.length > 0 && (
              <div className="space-y-3 mt-4 pt-2 border-t border-slate-100 dark:border-slate-200 dark:border-nord-3/80 pl-2 sm:pl-4">
                {sec.subsections.map((subSec) => renderSectionBlock(subSec, level + 1))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const modifiedCount = Object.keys(sectionOverrides).length;

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="space-y-3 border-b border-slate-200 dark:border-slate-200 dark:border-nord-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-900 dark:text-nord-6 flex items-center gap-2">
              <span>Предпросмотр и интерактивная правка ТЗ</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 font-mono font-medium">
                {decisions.standardProfileId === 'legacy-gost34-602-89'
                  ? 'ГОСТ 34.602-89'
                  : 'ГОСТ 34.602-2020'}
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Интерактивный просмотр сгенерированной структуры документа с возможностью точечного
              редактирования формулировок и работы с черновиками ИИ
            </p>
          </div>

          <div className="flex items-center gap-2">
            {modifiedCount > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Правок в разделах: <strong>{modifiedCount}</strong>
              </span>
            )}
            <input
              type="text"
              placeholder="Поиск по разделам ТЗ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input !py-1 text-xs w-48 sm:w-60"
            />
          </div>
        </div>

        {/* Top LLM Controls Bar */}
        {canUseTzAuthor && (
          <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 dark:border-nord-blue/20 dark:bg-nord-blue/5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-brand-800 dark:text-brand-300 flex items-center gap-1.5">
                  <span>✨</span>
                  <span>ИИ-автор ТЗ:</span>
                </span>
                <span className="font-mono text-slate-600 dark:text-nord-4 bg-white dark:bg-nord-2 px-2 py-0.5 rounded border border-slate-200 dark:border-nord-3 text-[11px]">
                  {llmProviderId
                    ? `${llmProviderId}${llmSelectedModel ? ` / ${llmSelectedModel}` : ''}`
                    : 'провайдер по умолчанию'}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    llmAvailable
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      llmAvailable ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  />
                  {llmAvailable ? 'Готов к работе' : 'Сервер недоступен'}
                </span>
                {acceptedCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium">
                    Принято: {acceptedCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!batch.isRunning ? (
                  <button
                    type="button"
                    onClick={() => batch.startBatch(draftableNodes, { onlyUnproposed: true })}
                    disabled={!llmAvailable || draftableNodes.length === 0 || generatingNodeId !== null}
                    className="btn-primary !py-1 !px-3 text-xs flex items-center gap-1.5 font-semibold bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:opacity-50"
                    title="Последовательно сформировать черновики ИИ для всех разделов ТЗ"
                  >
                    <span>✨</span>
                    <span>
                      {unproposedDraftCount === 0
                        ? 'Пересоздать всё ТЗ'
                        : `Черновик всего ТЗ (${unproposedDraftCount})`}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={batch.cancelBatch}
                    className="btn-secondary !py-1 !px-3 text-xs flex items-center gap-1.5 font-semibold text-rose-700 border-rose-300 bg-white hover:bg-rose-50 dark:border-rose-800 dark:bg-nord-2 dark:text-rose-300"
                  >
                    <span>⏹️</span>
                    <span>Отмена ({batch.currentIndex}/{batch.totalCount})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowLlmSettings(!showLlmSettings)}
                  className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1 font-medium text-slate-700 dark:text-nord-4"
                >
                  <span>⚙️</span>
                  <span>{showLlmSettings ? 'Скрыть настройки' : 'Настройки'}</span>
                </button>
              </div>
            </div>

            {/* Batch Progress Bar */}
            {batch.isRunning && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-nord-muted">
                  <span className="flex items-center gap-1.5 font-medium text-brand-700 dark:text-brand-300">
                    <span className="animate-spin text-xs">⏳</span>
                    <span>
                      Формирование черновиков: {batch.currentIndex} из {batch.totalCount}…
                      {batch.currentNode ? ` «${batch.currentNode.title}»` : ''}
                    </span>
                  </span>
                  <span className="font-mono">
                    {Math.round((batch.currentIndex / (batch.totalCount || 1)) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-indigo-200/60 dark:bg-nord-3 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-brand-600 h-1.5 rounded-full transition-all duration-300 ease-out"
                    style={{
                      width: `${Math.round((batch.currentIndex / (batch.totalCount || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Batch Cancelled notification */}
            {batch.isCancelled && !batch.isRunning && (
              <div className="flex items-center justify-between text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
                <span>Пакетная генерация остановлена пользователем.</span>
                <button
                  type="button"
                  onClick={() => batch.startBatch(draftableNodes, { onlyUnproposed: true })}
                  className="text-amber-900 dark:text-amber-200 font-semibold underline hover:no-underline ml-2"
                >
                  Продолжить
                </button>
              </div>
            )}

            {/* Batch Errors notification */}
            {batch.failedNodes.length > 0 && !batch.isRunning && (
              <div className="flex items-center justify-between text-[11px] text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-lg px-2.5 py-1.5">
                <span>Ошибок при генерации: {batch.failedNodes.length} из {batch.totalCount}.</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => batch.retryFailed()}
                    className="text-rose-900 dark:text-rose-200 font-semibold underline hover:no-underline"
                  >
                    Повторить ошибки
                  </button>
                  <button
                    type="button"
                    onClick={batch.resetBatch}
                    className="text-slate-500 hover:text-slate-700 dark:text-nord-muted"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsible LLM Settings Panel */}
        {canUseTzAuthor && showLlmSettings && (
          <LlmSettingsPanel
            llmAvailable={llmAvailable}
            llmError={llmError}
            llmProviders={llmProviders}
            llmProviderId={llmProviderId}
            setLlmProviderId={setLlmProviderId}
            llmModels={llmModels}
            llmSelectedModel={llmSelectedModel}
            setLlmSelectedModel={setLlmSelectedModel}
            onCheckStatus={() => checkLlmStatus(llmProviderId)}
          />
        )}
      </div>

      {loading && (
        <div className="py-12 text-center text-slate-500 text-xs">
          Сборка предпросмотра документа ГОСТ 34...
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300">
          {error}
        </div>
      )}

      {!loading && !error && ast && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Section Outline (Left) */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-200 dark:border-nord-3 bg-slate-50/50 dark:bg-nord-dark p-3 space-y-1.5 max-h-[600px] overflow-y-auto">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted dark:text-slate-500 px-2 py-1">
              Оглавление ТЗ ({flatSections.length} разд.)
            </div>
            {filteredSections.map(({ section, level }) => {
              const badge = getSectionBadge(section);
              const isActive = activeSectionTitle === section.title;

              return (
                <button
                  key={section.title}
                  type="button"
                  onClick={() => {
                    setActiveSectionTitle(section.title);
                    const el = document.getElementById(`sec-${encodeURIComponent(section.title)}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between gap-1.5 ${
                    isActive
                      ? 'bg-brand-600 text-white font-medium shadow-sm'
                      : 'text-slate-700 dark:text-nord-4 hover:bg-slate-100 dark:hover:bg-nord-3'
                  } ${level > 1 ? 'pl-5 text-[11px]' : ''}`}
                >
                  <span className="truncate">{section.title}</span>
                  {badge && (
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${badge.dotClass}`}
                      title={badge.label}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Document Content (Right) */}
          <div className="lg:col-span-8 space-y-4 max-h-[600px] overflow-y-auto pr-1">
            {ast.sections.map((sec) => renderSectionBlock(sec, 1))}
          </div>
        </div>
      )}
    </div>
  );
}
