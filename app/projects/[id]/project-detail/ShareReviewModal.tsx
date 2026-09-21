'use client';

import { useEffect, useState } from 'react';
import type { SerializedGostPackage } from './types';

export default function ShareReviewModal({
  pkg,
  onClose,
}: {
  pkg: SerializedGostPackage;
  onClose: () => void;
}) {
  const [shareLink, setShareLink] = useState('');
  const [generating, setGenerating] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;

    async function generate() {
      setGenerating(true);
      setCopied(false);
      try {
        const res = await fetch(`/api/calculations/${pkg.calculationId}/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scopes: ['review', 'export', 'read'],
            ttlSeconds: 60 * 60 * 24 * 14,
          }),
        });
        if (!res.ok) throw new Error('Не удалось создать share-ссылку');
        const data = await res.json();
        if (!active) return;
        setShareLink(`${window.location.origin}/review/${pkg.id}?share=${data.token}`);
      } catch {
        if (!active) return;
        setShareLink('');
        alert('Ошибка при генерации ссылки для согласования');
      } finally {
        if (active) setGenerating(false);
      }
    }

    void generate();
    return () => {
      active = false;
    };
  }, [pkg.calculationId, pkg.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="card w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">Ссылка для согласования Заказчиком</h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">Безопасный доступ без необходимости регистрации и staff-логина</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold" aria-label="Закрыть" />
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 dark:text-nord-4">
            По этой ссылке представитель Заказчика может изучить комплект ГОСТ 34, скачать неизменяемый ZIP-архив (с проверкой SHA-256) и утвердить или отклонить выпуск.
          </p>

          {generating ? (
            <div className="text-xs text-slate-500 animate-pulse text-center py-4">Генерация криптографического токена доступа...</div>
          ) : shareLink ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input type="text" readOnly value={shareLink} className="input text-xs font-mono select-all flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(shareLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                  className="btn-primary text-xs font-bold whitespace-nowrap"
                >
                  {copied ? 'Скопировано!' : 'Скопировать'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Срок действия ссылки: 14 дней. Права: просмотр, скачивание ZIP, согласование (без права изменения сметы).</p>
            </div>
          ) : null}

          <div className="pt-3 flex items-center justify-end border-t border-slate-100 dark:border-nord-3">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  );
}
