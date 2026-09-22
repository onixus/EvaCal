'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PackageDiffResult } from '@/lib/gost34/diff';
import type { SerializedGostPackage } from './types';

export default function PackageDiffModal({
  projectId,
  packages,
  onClose,
}: {
  projectId: string;
  packages: SerializedGostPackage[];
  onClose: () => void;
}) {
  const [fromPkgId, setFromPkgId] = useState(packages[1]?.id || packages[0]?.id || '');
  const [toPkgId, setToPkgId] = useState(packages[0]?.id || '');
  const [diffResult, setDiffResult] = useState<PackageDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiff = useCallback(
    async (fromId: string, toId: string) => {
      if (!fromId || !toId || fromId === toId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/packages/diff?from=${fromId}&to=${toId}`,
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Не удалось сравнить версии');
        }
        const data = await res.json();
        setDiffResult(data.diff);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка при вычислении diff');
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  // Сравнение подгружается один раз при открытии. Перезапуск по смене ссылки
  // на packages (например, после router.refresh()) сбрасывал бы выбранные
  // пользователем версии обратно на две последние.
  useEffect(() => {
    if (packages.length >= 2) void loadDiff(packages[1].id, packages[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
      <div className="card w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Структурное сравнение версий комплектов ГОСТ 34
            </h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              Анализ изменений требований, покрытия трассировки, применимости и оверрайдов
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

        <div className="border-b border-slate-200 bg-white p-4 dark:border-nord-3 dark:bg-nord-0 shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-nord-4">
                Базовая версия (Откуда):
              </span>
              <select
                value={fromPkgId}
                onChange={(e) => {
                  setFromPkgId(e.target.value);
                  void loadDiff(e.target.value, toPkgId);
                }}
                className="input text-xs"
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    v{pkg.version} — {pkg.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-slate-400">→</div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-nord-4">
                Целевая версия (Куда):
              </span>
              <select
                value={toPkgId}
                onChange={(e) => {
                  setToPkgId(e.target.value);
                  void loadDiff(fromPkgId, e.target.value);
                }}
                className="input text-xs"
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    v{pkg.version} — {pkg.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void loadDiff(fromPkgId, toPkgId)}
              disabled={loading || fromPkgId === toPkgId}
              className="btn-secondary text-xs font-bold"
            >
              {loading ? 'Сравнение...' : 'Обновить'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {fromPkgId === toPkgId && (
            <div className="rounded-lg bg-amber-50 p-4 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-center">
              Выберите две разные версии для сравнения.
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-50 p-4 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}
          {loading && (
            <div className="py-12 text-center text-xs text-slate-500 animate-pulse">
              Вычисление структурной дельты документов...
            </div>
          )}

          {diffResult && !loading && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="card p-3 bg-slate-50 dark:bg-nord-1/40">
                  <div className="text-[11px] text-slate-500 dark:text-nord-muted">Требования</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-nord-6">
                    {diffResult.requirements.totalFrom} → {diffResult.requirements.totalTo}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    +{diffResult.requirements.added.length} / -
                    {diffResult.requirements.removed.length} / ~
                    {diffResult.requirements.modified.length}
                  </div>
                </div>
                <div className="card p-3 bg-slate-50 dark:bg-nord-1/40">
                  <div className="text-[11px] text-slate-500 dark:text-nord-muted">
                    Покрытие трассировки
                  </div>
                  <div className="text-lg font-bold text-slate-900 dark:text-nord-6">
                    {diffResult.traceability.coverageFrom}% → {diffResult.traceability.coverageTo}%
                  </div>
                  <div className="text-[10px] text-slate-400">
                    +{diffResult.traceability.addedLinks.length} связей / -
                    {diffResult.traceability.removedLinks.length}
                  </div>
                </div>
                <div className="card p-3 bg-slate-50 dark:bg-nord-1/40">
                  <div className="text-[11px] text-slate-500 dark:text-nord-muted">
                    Нормативный профиль
                  </div>
                  <div className="text-xs font-bold text-slate-900 dark:text-nord-6 truncate">
                    {diffResult.general.profileChanged ? 'ИЗМЕНЁН' : 'Без изменений'}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {diffResult.general.profileTo}
                  </div>
                </div>
                <div className="card p-3 bg-slate-50 dark:bg-nord-1/40">
                  <div className="text-[11px] text-slate-500 dark:text-nord-muted">
                    Правки разделов (Overrides)
                  </div>
                  <div className="text-lg font-bold text-slate-900 dark:text-nord-6">
                    {diffResult.sections.overrides.length}
                  </div>
                  <div className="text-[10px] text-slate-400">кастомных правок разделов</div>
                </div>
              </div>

              {diffResult.requirements.added.length > 0 && (
                <div className="card p-4 border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/10">
                  <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-2">
                    + Добавленные требования ({diffResult.requirements.added.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {diffResult.requirements.added.map((req) => (
                      <div
                        key={req.id}
                        className="p-2 rounded bg-white dark:bg-nord-1 text-xs border border-emerald-100 dark:border-emerald-900/40"
                      >
                        <div className="font-semibold text-slate-800 dark:text-nord-5">
                          {req.originalText}
                        </div>
                        {req.source && (
                          <div className="text-[10px] text-slate-400">Источник: {req.source}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diffResult.requirements.removed.length > 0 && (
                <div className="card p-4 border-rose-200 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/10">
                  <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300 mb-2">
                    - Удалённые требования ({diffResult.requirements.removed.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {diffResult.requirements.removed.map((req) => (
                      <div
                        key={req.id}
                        className="p-2 rounded bg-white dark:bg-nord-1 text-xs border border-rose-100 dark:border-rose-900/40"
                      >
                        <div className="line-through text-slate-500 dark:text-nord-muted">
                          {req.originalText}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diffResult.requirements.modified.length > 0 && (
                <div className="card p-4 border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/10">
                  <h4 className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-2">
                    ~ Изменённые требования ({diffResult.requirements.modified.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {diffResult.requirements.modified.map((item) => (
                      <div
                        key={item.id}
                        className="p-2 rounded bg-white dark:bg-nord-1 text-xs border border-amber-100 dark:border-amber-900/40"
                      >
                        <div className="text-slate-400 line-through text-[11px]">
                          {item.from.originalText}
                        </div>
                        <div className="text-slate-900 dark:text-nord-6 font-semibold">
                          {item.to.originalText}
                        </div>
                        <div className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5">
                          Изменено: {item.changes.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diffResult.sections.overrides.length > 0 && (
                <div className="card p-4">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-nord-5 mb-2">
                    Кастомные правки разделов ТЗ ({diffResult.sections.overrides.length})
                  </h4>
                  <div className="space-y-1.5">
                    {diffResult.sections.overrides.map((section, index) => (
                      <div
                        key={index}
                        className="text-xs p-2 rounded bg-slate-50 dark:bg-nord-1 flex items-center justify-between"
                      >
                        <span className="font-mono text-slate-700 dark:text-nord-4">
                          {section.sectionKey}
                        </span>
                        <span className="text-[10px] uppercase font-bold text-brand-700 dark:text-nord-frost3">
                          {section.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-end shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
