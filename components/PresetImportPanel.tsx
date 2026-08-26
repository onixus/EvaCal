'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { INDUSTRY_PRESETS, IndustryPreset } from '@/lib/presets/industryPresets';

const CATEGORY_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  security: {
    label: 'Информационная безопасность',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
  },
  hardware_pac: {
    label: 'Оборудование и ПАК',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
  },
  compliance: {
    label: 'КИИ и Соответствие (ФСТЭК)',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    text: 'text-indigo-700 dark:text-indigo-300',
  },
  development: {
    label: 'Заказная разработка',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  migration: {
    label: 'Импортозамещение и миграции',
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-300',
  },
  monitoring: {
    label: 'SIEM и мониторинг ИБ',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    text: 'text-violet-700 dark:text-violet-300',
  },
  infrastructure: {
    label: 'Резервное копирование и инфраструктура',
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    text: 'text-teal-700 dark:text-teal-300',
  },
};

export default function PresetImportPanel() {
  const router = useRouter();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importingAll, setImportingAll] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleImport(presetId: string, setAsActive: boolean = false) {
    setImportingId(presetId);
    setMessage(null);
    try {
      const res = await fetch('/api/templates/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId, setAsActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка импорта');
      setMessage({ type: 'success', text: `Шаблон «${data.template.name}» успешно импортирован!` });
      router.refresh();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Ошибка импорта' });
    } finally {
      setImportingId(null);
    }
  }

  async function handleImportAll() {
    setImportingAll(true);
    setMessage(null);
    try {
      const res = await fetch('/api/templates/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importAll: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка импорта');
      setMessage({ type: 'success', text: `Импортировано новых шаблонов: ${data.count} шт.` });
      router.refresh();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Ошибка импорта' });
    } finally {
      setImportingAll(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Отраслевые пресеты ИТ / ИБ / ПАК
          </h3>
          <p className="text-xs text-slate-500">
            Готовые шаблоны опросников с настроенными драйверами трудозатрат, этапами работ и
            рисками
          </p>
        </div>
        <button
          type="button"
          onClick={handleImportAll}
          disabled={importingAll || !!importingId}
          className="btn-secondary text-xs px-3 py-1.5 self-start sm:self-auto"
        >
          {importingAll ? 'Импорт всех...' : 'Импортировать все пресеты'}
        </button>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {INDUSTRY_PRESETS.map((preset) => {
          const badge = CATEGORY_LABELS[preset.category] || {
            label: preset.category,
            bg: 'bg-slate-100 dark:bg-slate-800',
            text: 'text-slate-700 dark:text-slate-300',
          };
          const isBusy = importingId === preset.id || importingAll;

          return (
            <div
              key={preset.id}
              className="flex flex-col justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-nord-dark hover:border-brand-500/50 transition-all shadow-sm"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}
                  >
                    {badge.label}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Маржа: {preset.defaultMarginPercent}%
                  </span>
                </div>
                <h4 className="font-medium text-sm text-slate-900 dark:text-slate-100 leading-snug">
                  {preset.name}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 leading-relaxed">
                  {preset.description}
                </p>

                <div className="flex items-center gap-3 pt-2 text-[11px] text-slate-500">
                  <span title="Количество вопросов в опроснике">
                    📋 Полей: <strong>{preset.fields.length}</strong>
                  </span>
                  <span title="Количество этапов календарного плана">
                    ⚙️ Этапов: <strong>{preset.stageTemplates.length}</strong>
                  </span>
                  <span title="Типовые проектные риски">
                    🛡️ Рисков: <strong>{preset.riskTemplates.length}</strong>
                  </span>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800/60 mt-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleImport(preset.id, false)}
                  className="btn-secondary text-xs px-2.5 py-1"
                >
                  {importingId === preset.id ? 'Импорт...' : 'Импортировать'}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleImport(preset.id, true)}
                  className="btn-primary text-xs px-2.5 py-1"
                  title="Импортировать и сделать активным для пресейла"
                >
                  Импортировать и активировать
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
