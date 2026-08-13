'use client';

import { useState } from 'react';
import Gost34WizardModal from './gost34/Gost34WizardModal';
import { withShareHeaders } from '@/lib/shareClient';

type ExportFormat = 'pdf' | 'xlsx' | 'json';

const FALLBACK_NAME: Record<ExportFormat, string> = {
  pdf: 'calculation.pdf',
  xlsx: 'calculation.xlsx',
  json: 'calculation.json',
};

const FORMAT_CONFIG: Record<ExportFormat, { label: string; ext: string; color: string }> = {
  pdf: { label: 'PDF', ext: 'pdf', color: 'text-rose-600 dark:text-nord-redText' },
  xlsx: { label: 'Excel', ext: 'xlsx', color: 'text-emerald-600 dark:text-nord-green' },
  json: { label: 'JSON', ext: 'json', color: 'text-amber-600 dark:text-nord-yellow' },
};

/** Reads the server-provided name, preferring the RFC 5987 form that carries Cyrillic. */
function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // fall through to the plain form
    }
  }
  const plain = header.match(/filename="([^"]+)"/i);
  return plain?.[1] || fallback;
}

export default function ExportLinks({ calculationId }: { calculationId: string }) {
  const [isGostModalOpen, setIsGostModalOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState('');

  const download = async (format: ExportFormat) => {
    setBusy(format);
    setError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/${format}`, {
        headers: withShareHeaders(calculationId),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Не удалось выгрузить файл');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFromDisposition(
        res.headers.get('Content-Disposition'),
        FALLBACK_NAME[format],
      );
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выгрузить файл');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsGostModalOpen(true)}
          className="btn-primary !py-1.5 !px-3 text-xs font-semibold shadow-xs"
          title="Мастер ГОСТ 34: профиль, требования, применимость, трассируемость и выпуск"
        >
          <span className="text-sm">📑</span>
          <span>Мастер ГОСТ 34</span>
        </button>

        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-xs dark:border-nord-3 dark:bg-nord-2">
          {(['pdf', 'xlsx', 'json'] as const).map((format) => {
            const cfg = FORMAT_CONFIG[format];
            const isCurrent = busy === format;

            return (
              <button
                key={format}
                type="button"
                onClick={() => download(format)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-nord-4 dark:hover:bg-nord-3 dark:hover:text-nord-6"
                title={`Скачать в формате ${cfg.label}`}
              >
                {isCurrent ? (
                  <span className="animate-spin text-xs">⏳</span>
                ) : (
                  <span className={`font-bold text-[10px] uppercase ${cfg.color}`}>{cfg.ext}</span>
                )}
                <span>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {error ? <p className="mt-1 text-xs font-medium text-rose-600 dark:text-nord-redText">{error}</p> : null}

      <Gost34WizardModal
        calculationId={calculationId}
        isOpen={isGostModalOpen}
        onClose={() => setIsGostModalOpen(false)}
      />
    </>
  );
}
