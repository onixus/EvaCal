'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { roleLabel } from '@/lib/roles';
import type { CapacityWarning } from '@/lib/capacity';

function fmtWeek(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/** Полоса над Гантом: недели, где этот расчёт перегружает роль (E2). */
export default function CapacityWarnings({
  calculationId,
  refreshKey,
}: {
  calculationId: string;
  refreshKey?: string;
}) {
  const [warnings, setWarnings] = useState<CapacityWarning[]>([]);
  useEffect(() => {
    fetch(`/api/calculations/${calculationId}/capacity-warnings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { warnings: [] }))
      .then((d) => setWarnings(d.warnings ?? []))
      .catch(() => setWarnings([]));
  }, [calculationId, refreshKey]);
  if (warnings.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200"
      data-testid="capacity-warnings"
    >
      <strong>Перегруз по портфелю:</strong>{' '}
      {warnings.map((w) => (
        <span key={w.role} className="mr-3">
          {roleLabel(w.role)} до {Math.round(w.maxUtil * 100)}% на нед.{' '}
          {w.weeks.map(fmtWeek).join(', ')} (ваш вклад {w.ownHours} ч)
        </span>
      ))}
      <Link href="/capacity" className="underline">
        ресурсный план
      </Link>
    </div>
  );
}
