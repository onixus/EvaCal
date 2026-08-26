'use client';

import { CHANGE_SOURCE_TONE, type InternalChangeRow } from '@/lib/changelogTypes';

interface InternalChangelogViewProps {
  calculationId: string;
  calculationName: string;
  changes: InternalChangeRow[];
  shareToken: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/**
 * Лист внутренних изменений — отдельный документ комплекта, а не журнал
 * приложения: он выгружается в .xlsx и кладётся в ZIP рядом с ТЗ. Поэтому
 * колонки повторяют печатную форму, а не поля таблицы.
 */
export default function InternalChangelogView({
  calculationId,
  calculationName,
  changes,
  shareToken,
}: InternalChangelogViewProps) {
  const exportUrl = `/api/calculations/${calculationId}/changelog/xlsx${
    shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''
  }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
            Лист внутренних изменений — {calculationName}
          </h1>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-nord-muted">
            Все правки комплекта и расчёта: inline-правки студии, загруженные версии тех.писателя,
            решения ревью. Хранится отдельным файлом при расчёте.
          </p>
        </div>

        <a href={exportUrl} download className="btn-secondary shrink-0 !text-xs">
          ⬇ Выгрузить (.xlsx)
        </a>
      </div>

      <div className="card-flat overflow-hidden">
        {changes.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500 dark:text-nord-muted">
            Изменений пока нет. Первая запись появится после правки в студии, загрузки версии
            тех.писателя или решения ревью.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-nord-3 dark:bg-nord-1">
                  {['№', 'Дата', 'Автор · роль', 'Документ · раздел', 'Изменение', 'Источник'].map(
                    (head) => (
                      <th
                        key={head}
                        className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted"
                      >
                        {head}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
                {changes.map((change) => (
                  <tr key={change.id} className="align-top">
                    <td className="nums whitespace-nowrap px-3 py-2.5 font-mono font-bold text-brand-700 dark:text-nord-frost2">
                      {change.num}
                    </td>
                    <td className="nums whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-nord-4">
                      {formatDate(change.occurredAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-800 dark:text-nord-5">
                        {change.author}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-nord-muted">
                        {change.roleLabel}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-nord-4">{change.docRef}</td>
                    <td className="px-3 py-2.5 leading-relaxed text-slate-700 dark:text-nord-4">
                      {change.text}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          CHANGE_SOURCE_TONE[change.source] === 'ok' ? 'chip-ok' : 'chip-muted'
                        }
                      >
                        {change.sourceLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
