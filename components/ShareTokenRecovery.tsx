'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getShareToken, storeShareToken } from '@/lib/shareClient';

/**
 * When a server page denied access (no session / no ?share=), try sessionStorage
 * and re-enter with the token in the query string so RSC can verify it.
 */
export default function ShareTokenRecovery({
  calculationId,
  pathPrefix = '/presale',
}: {
  calculationId: string;
  pathPrefix?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'missing'>('checking');

  useEffect(() => {
    const fromStorage = getShareToken(calculationId);
    const fromUrl =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('share')
        : null;
    const token = fromStorage || fromUrl;
    if (token) {
      storeShareToken(calculationId, token);
      router.replace(`${pathPrefix}/${calculationId}?share=${encodeURIComponent(token)}`);
      return;
    }
    setStatus('missing');
  }, [calculationId, pathPrefix, router]);

  if (status === 'checking') {
    return <div className="card p-8 text-center text-slate-500">Проверяем доступ к расчёту…</div>;
  }

  return (
    <div className="card space-y-4 p-8 text-center">
      <h1 className="text-lg font-semibold text-slate-800">Нет доступа к расчёту</h1>
      <p className="text-sm text-slate-500">
        Нужна share-ссылка (параметр <code className="text-xs">?share=</code>) или вход сотрудника
        (архитектор / администратор).
      </p>
      <div className="flex justify-center gap-3">
        <Link href="/login" className="btn-primary">
          Войти
        </Link>
        <Link href="/presale" className="btn-secondary">
          К пресейлу
        </Link>
      </div>
    </div>
  );
}
