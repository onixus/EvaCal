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

  // Downloads go through fetch with the share token in a header rather than a plain <a>
  // carrying ?share=. The token is a reusable, write-capable credential and nginx logs the
  // full request URI by default, so putting it in the query string leaks it into access logs.
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
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setIsGostModalOpen(true)}
          className="btn-secondary font-medium text-nord-accent border-nord-accent/40 hover:border-nord-accent"
          title="Мастер ГОСТ 34: профиль, требования, применимость, трассируемость и выпуск"
        >
          Мастер ГОСТ 34
        </button>
        {(['pdf', 'xlsx', 'json'] as const).map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => download(format)}
            disabled={busy !== null}
            className="btn-secondary disabled:opacity-50"
          >
            {busy === format ? '…' : format.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      <Gost34WizardModal
        calculationId={calculationId}
        isOpen={isGostModalOpen}
        onClose={() => setIsGostModalOpen(false)}
      />
    </>
  );
}
