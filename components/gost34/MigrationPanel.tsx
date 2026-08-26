'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GostDocumentType } from '@/lib/gost34/types';
import type { MigrationDiff, ProjectStandardBinding } from '@/lib/gost34/migration/types';
import { PANEL_CLASS, SUBPANEL_CLASS } from './wizardShared';

interface MigrationResponse {
  binding: ProjectStandardBinding;
  targetProfileId?: string;
  diff: MigrationDiff;
}

interface MigrationPanelProps {
  calculationId: string;
  docType: GostDocumentType;
  /** Сообщает мастеру о новом профиле проекта после успешной миграции. */
  onMigrated: (standardProfileId: string) => void;
}

const LIST_LIMIT = 8;

function SectionList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'add' | 'remove' | 'move';
  items: { key: string; text: string }[];
}) {
  if (items.length === 0) return null;

  const toneClass =
    tone === 'add'
      ? 'text-emerald-300 border-emerald-500/40'
      : tone === 'remove'
        ? 'text-red-300 border-red-500/40'
        : 'text-amber-300 border-amber-500/40';

  return (
    <div className={`${SUBPANEL_CLASS} p-3`}>
      <div className={`text-[11px] font-bold uppercase tracking-wider border-b pb-1 ${toneClass}`}>
        {title} — {items.length}
      </div>
      <ul className="mt-2 space-y-1">
        {items.slice(0, LIST_LIMIT).map((item) => (
          <li
            key={item.key}
            className="text-[11px] text-slate-600 dark:text-nord-4 leading-relaxed"
          >
            {item.text}
          </li>
        ))}
      </ul>
      {items.length > LIST_LIMIT && (
        <p className="text-[10px] text-slate-500 mt-1.5">…и ещё {items.length - LIST_LIMIT}</p>
      )}
    </div>
  );
}

/**
 * Экран миграции проекта на действующий нормативный профиль (раздел 5 плана).
 * Показывает diff до записи: структура документа, новые разделы, снятые
 * legacy-ссылки, новые требования, конфликты и неприменимые нормативы.
 */
export default function MigrationPanel({
  calculationId,
  docType,
  onMigrated,
}: MigrationPanelProps) {
  const [data, setData] = useState<MigrationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');

  const loadPreview = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/calculations/${calculationId}/gost34/migration?docType=${docType}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Не удалось рассчитать изменения миграции.');
      setData(body as MigrationResponse);
    } catch (err: any) {
      setError(err?.message || 'Не удалось рассчитать изменения миграции.');
    } finally {
      setIsLoading(false);
    }
  }, [calculationId, docType]);

  // Предпросмотр перечитывается при смене документа: разделы у ТЗ и ПЗ разные.
  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const apply = async () => {
    if (!data) return;
    setIsApplying(true);
    setError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/gost34/migration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, targetProfileId: data.diff.to.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Не удалось выполнить миграцию проекта.');
      setData(body as MigrationResponse);
      onMigrated((body as MigrationResponse).binding.standardProfileId);
    } catch (err: any) {
      setError(err?.message || 'Не удалось выполнить миграцию проекта.');
    } finally {
      setIsApplying(false);
    }
  };

  const binding = data?.binding;
  const diff = data?.diff;

  return (
    <div className={`${PANEL_CLASS} space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-brand-700 dark:text-nord-frost2 uppercase tracking-wider">
            Нормативная привязка проекта
          </h4>
          <p className="text-xs text-slate-600 dark:text-nord-4 mt-1">
            Профиль, по которому проект выпускался ранее, хранится в расчёте. Миграция меняет его на
            действующую редакцию — но только после просмотра изменений.
          </p>
        </div>
        {binding && (
          <span className="shrink-0 px-3 py-1 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-nord-3 text-brand-700 dark:text-nord-frost2 border border-slate-300 dark:border-nord-3">
            {binding.standardProfileId}@{binding.standardProfileVersion}
            {binding.inferred ? ' • по умолчанию' : ''}
          </span>
        )}
      </div>

      {binding && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-500 dark:text-nord-muted">
          <div className={`${SUBPANEL_CLASS} p-2.5`}>
            Версия генератора:{' '}
            <strong className="text-slate-800 dark:text-nord-5">{binding.generatorVersion}</strong>
          </div>
          <div className={`${SUBPANEL_CLASS} p-2.5`}>
            Последний выпуск:{' '}
            <strong className="text-slate-800 dark:text-nord-5">
              {binding.generatedAt
                ? new Date(binding.generatedAt).toLocaleDateString('ru-RU')
                : 'не выпускался'}
            </strong>
          </div>
          <div className={`${SUBPANEL_CLASS} p-2.5`}>
            Документ diff: <strong className="text-slate-800 dark:text-nord-5">{docType}</strong>
          </div>
        </div>
      )}

      {isLoading && (
        <p className="text-xs text-slate-500 dark:text-nord-muted">Расчёт изменений…</p>
      )}

      {error && (
        <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl p-3">
          {error}
        </p>
      )}

      {diff && diff.alreadyMigrated && (
        <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-3">
          Проект уже выпускается по профилю «{diff.to.name}» ({diff.to.primaryStandard}). Миграция
          не требуется.
        </p>
      )}

      {diff && !diff.alreadyMigrated && (
        <div className="space-y-3">
          <p className="text-xs text-slate-600 dark:text-nord-4">
            <strong className="text-slate-900 dark:text-nord-6">{diff.from.name}</strong> (
            {diff.from.primaryStandard}) →{' '}
            <strong className="text-slate-900 dark:text-nord-6">{diff.to.name}</strong> (
            {diff.to.primaryStandard}). Сохранено разделов без изменения номера:{' '}
            {diff.structure.unchanged}.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <SectionList
              title="Новые разделы"
              tone="add"
              items={diff.structure.added.map((s) => ({
                key: `add-${s.id}-${s.numStr}`,
                text: `${s.numStr}. ${s.title}`,
              }))}
            />
            <SectionList
              title="Удалённые разделы"
              tone="remove"
              items={diff.structure.removed.map((s) => ({
                key: `rm-${s.id}-${s.numStr}`,
                text: `${s.numStr}. ${s.title}`,
              }))}
            />
            <SectionList
              title="Изменённая нумерация"
              tone="move"
              items={diff.structure.renumbered.map((s) => ({
                key: `mv-${s.id}-${s.numStr}`,
                text: `${s.previousNumStr} → ${s.numStr}. ${s.title}`,
              }))}
            />
            <SectionList
              title="Снятые legacy-ссылки"
              tone="remove"
              items={diff.removedLegacyReferences.map((ref) => ({
                key: `ref-${ref.citation}`,
                text: ref.replacedBy ? `${ref.citation} → ${ref.replacedBy}` : ref.citation,
              }))}
            />
            <SectionList
              title="Новые требования"
              tone="add"
              items={diff.addedRequirements.map((req) => ({
                key: `req-${req.code}`,
                text: `${req.code} — ${req.title}`,
              }))}
            />
            <SectionList
              title="Конфликты требований"
              tone="remove"
              items={diff.conflicts.map((finding, idx) => ({
                key: `cf-${finding.requirementId || 'summary'}-${idx}`,
                text: `${finding.requirementCode || 'сводное'}: ${finding.message}`,
              }))}
            />
            <SectionList
              title="Нарушения структуры"
              tone="move"
              items={diff.schemaIssues.map((issue) => ({
                key: `si-${issue.nodeId}-${issue.kind}`,
                text: issue.message,
              }))}
            />
            <SectionList
              title="Неприменимые / неподтверждённые нормативы"
              tone="move"
              items={diff.inapplicableRegulations.map((item) => ({
                key: `ap-${item.standardId}`,
                text: `${item.title} — ${
                  item.status === 'UNKNOWN' ? 'требует подтверждения' : 'не применимо'
                }`,
              }))}
            />
          </div>

          {diff.requiresAttention && (
            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded-xl p-3">
              Миграция допустима, но после неё документ ещё не готов к согласованию: устраните
              конфликты, нарушения структуры и незаполненные сведения проектного контекста.
            </p>
          )}

          <button
            type="button"
            onClick={apply}
            disabled={isApplying || isLoading}
            className="px-4 py-2.5 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-600 disabled:text-slate-300 text-white transition-colors"
          >
            {isApplying ? 'Миграция…' : `Мигрировать на ${diff.to.primaryStandard}`}
          </button>
        </div>
      )}
    </div>
  );
}
