'use client';

import { useState, useEffect, useMemo } from 'react';
import type { WizardStepProps } from '../wizardShared';
import type { Gost34DocumentAST, Gost34Section, Gost34TableData } from '@/lib/gost34/types';

interface DocumentPreviewStepProps extends WizardStepProps {
  calculationId: string;
  onUpdateSectionOverrides: (
    overrides: Record<string, { title?: string; paragraphs?: string[] }>,
  ) => void;
}

export default function DocumentPreviewStep({
  decisions,
  calculationId,
  onUpdateSectionOverrides,
}: DocumentPreviewStepProps) {
  const [ast, setAst] = useState<Gost34DocumentAST | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSectionTitle, setActiveSectionTitle] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState<string | null>(null);
  const [editParagraphs, setEditParagraphs] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calculationId,
            rawRequirements: decisions.rawRequirements,
            standardProfileId: decisions.standardProfileId,
            applicabilityOverrides: decisions.applicabilityOverrides,
            manualLinks: decisions.manualLinks,
            sectionOverrides,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Не удалось сформировать предпросмотр документа');
        }

        const data = await res.json();
        if (!isCancelled) {
          setAst(data.ast);
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
    decisions.rawRequirements,
    decisions.standardProfileId,
    decisions.applicabilityOverrides,
    decisions.manualLinks,
    sectionOverrides,
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
        className="my-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800"
      >
        {table.caption && (
          <div className="bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
            {table.caption}
          </div>
        )}
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400">
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
              <tr
                key={rIdx}
                className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
              >
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3 py-2 text-slate-800 dark:text-slate-200 align-top">
                    {String(cell)}
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
    const isOverridden = !!sectionOverrides[sec.title];

    return (
      <div
        key={sec.title}
        id={`sec-${encodeURIComponent(sec.title)}`}
        className={`p-4 rounded-xl border transition-all ${
          activeSectionTitle === sec.title
            ? 'border-brand-500 bg-brand-50/10 dark:border-brand-500/80'
            : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-nord-dark'
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <h4
              className={`font-semibold text-slate-900 dark:text-slate-100 ${
                level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-xs'
              }`}
            >
              {sec.title}
            </h4>
            {isOverridden && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-medium">
                Изменён вручную
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
                {isOverridden && (
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
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
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
          <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {sec.paragraphs &&
              sec.paragraphs.map((p, pIdx) => (
                <p key={pIdx} className="text-justify">
                  {p}
                </p>
              ))}

            {sec.tables && sec.tables.map((tbl, tIdx) => renderTable(tbl, tIdx))}

            {sec.subsections && sec.subsections.length > 0 && (
              <div className="space-y-3 mt-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 pl-2 sm:pl-4">
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Предпросмотр и интерактивная правка ТЗ</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 font-mono font-medium">
              {decisions.standardProfileId === 'legacy-gost34-602-89'
                ? 'ГОСТ 34.602-89'
                : 'ГОСТ 34.602-2020'}
            </span>
          </h3>
          <p className="text-xs text-slate-500">
            Интерактивный просмотр сгенерированной структуры документа с возможностью точечного
            редактирования формулировок
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
          <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-nord-dark p-3 space-y-1.5 max-h-[600px] overflow-y-auto">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1">
              Оглавление ТЗ ({flatSections.length} разд.)
            </div>
            {filteredSections.map(({ section, level }) => {
              const isOverridden = !!sectionOverrides[section.title];
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
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  } ${level > 1 ? 'pl-5 text-[11px]' : ''}`}
                >
                  <span className="truncate">{section.title}</span>
                  {isOverridden && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"
                      title="Изменён"
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
