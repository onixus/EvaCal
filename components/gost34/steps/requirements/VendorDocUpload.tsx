'use client';

import { useState } from 'react';
import type { Gost34RequirementItem } from '@/lib/gost34/types';
import { PANEL_CLASS } from '../../wizardShared';

interface VendorDocUploadProps {
  uploadedFiles: string[];
  onUploadedFilesChange: (files: string[]) => void;
  requirements: Gost34RequirementItem[];
  onRequirementsChange: (reqs: Gost34RequirementItem[]) => void;
}

export default function VendorDocUpload({
  uploadedFiles,
  onUploadedFilesChange,
  requirements,
  onRequirementsChange,
}: VendorDocUploadProps) {
  const [isParsing, setIsParsing] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsParsing(true);
    setUploadError('');

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append('files', files[i]);

      const res = await fetch('/api/gost34/parse-vendor-doc', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Ошибка при обработке документа');
      }

      const data = await res.json();
      onUploadedFilesChange([...uploadedFiles, ...(data.parsedFiles || [])]);
      onRequirementsChange([...requirements, ...(data.extractedRequirements || [])]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка сервера';
      setUploadError(`Не удалось распарсить файл: ${msg}`);
    } finally {
      setIsParsing(false);
      e.target.value = '';
    }
  };

  return (
    <div className={`${PANEL_CLASS} space-y-3`}>
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-brand-700 dark:text-nord-frost2 uppercase tracking-wider">
            Загрузка исходных спецификаций ТЗ / ФТ / ТТ
          </h4>
          <p className="text-xs text-slate-600 dark:text-nord-4 mt-1">
            Загрузите файлы вендора (.docx, .txt, .md, .json) для авто-извлечения требований.
            Исходная формулировка сохраняется неизменной.
          </p>
        </div>
        {uploadedFiles.length > 0 && (
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            ✓ Загружено файлов: {uploadedFiles.length}
          </span>
        )}
      </div>

      <label className="cursor-pointer flex flex-col items-center justify-center p-7 rounded-xl border-2 border-dashed border-slate-300 dark:border-nord-3 hover:border-brand-500 bg-slate-50 dark:bg-nord-1 hover:bg-slate-100 dark:hover:bg-nord-3 transition-all">
        <span className="text-3xl mb-2">📁</span>
        <span className="text-sm font-bold text-slate-900 dark:text-nord-6">
          {isParsing
            ? 'Идёт обработка и анализ документа...'
            : 'Нажмите или перетащите файлы вендорского ТЗ сюда'}
        </span>
        <span className="text-xs text-slate-500 dark:text-nord-muted mt-1">
          Поддерживаются MS Word (.docx) и текстовые спецификации (.txt, .md, .json)
        </span>
        <input
          type="file"
          multiple
          accept=".docx,.txt,.md,.json"
          onChange={handleFileUpload}
          className="hidden"
          disabled={isParsing}
        />
      </label>

      {uploadError && (
        <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {uploadError}
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-nord-3">
          {uploadedFiles.map((fn, idx) => (
            <span
              key={`${fn}-${idx}`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-nord-3 text-slate-900 dark:text-nord-6 border border-slate-300 dark:border-nord-3"
            >
              📄 {fn}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
