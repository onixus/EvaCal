'use client';

import Link from 'next/link';
import { safeJsonParse } from '@/lib/json';
import { canDecideReviewStage, REVIEW_STAGE_LABELS, type ReviewStage } from '@/lib/gost34/review/types';
import { PackageStatusBadge } from './StatusBadges';
import type { SerializedCalculation, SerializedGostPackage } from './types';

function stageOf(pkg: SerializedGostPackage): ReviewStage {
  return pkg.reviewStage === 'gap' ? 'gap' : pkg.reviewStage === 'done' ? 'done' : 'tw';
}

export default function PackagesTab({
  packages,
  latestCalculation,
  sessionRole,
  onCompare,
  onShare,
  onReview,
}: {
  packages: SerializedGostPackage[];
  latestCalculation: SerializedCalculation | null;
  sessionRole: string | null;
  onCompare: () => void;
  onShare: (pkg: SerializedGostPackage) => void;
  onReview: (pkg: SerializedGostPackage, decision: 'approve' | 'reject') => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">Реестр комплектов документов ГОСТ 34</h2>
          <p className="text-xs text-slate-500 dark:text-nord-muted">
            Официальные выпуски ТЗ, ПМИ, ТП и сопутствующих документов с фиксацией профиля, неизменяемых ZIP-артефактов и контрольных сумм.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {packages.length >= 2 && (
            <button type="button" onClick={onCompare} className="btn-secondary text-xs bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-100 dark:bg-nord-3 dark:text-nord-frost3 font-bold">
              Сравнить версии
            </button>
          )}
          {latestCalculation && <Link href={`/calculations/${latestCalculation.id}`} className="btn-secondary text-xs">+ Выпустить комплект в мастере</Link>}
        </div>
      </div>

      {packages.length === 0 ? (
        <div className="card p-10 text-center">
          <h3 className="font-semibold text-slate-800 dark:text-nord-5">Комплекты ГОСТ 34 ещё не выпускались</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto dark:text-nord-muted">
            Откройте любой расчёт проекта и запустите мастер выпуска комплекта ГОСТ 34.
          </p>
          {latestCalculation && <div className="mt-4"><Link href={`/calculations/${latestCalculation.id}`} className="btn-primary text-xs">Перейти в расчёт</Link></div>}
        </div>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => {
            const docTypes = safeJsonParse<string[]>(pkg.documentTypes, ['tz']);
            const stage = stageOf(pkg);
            const canDecide = canDecideReviewStage(sessionRole, stage);

            return (
              <div key={pkg.id} className="card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-brand-700 dark:text-nord-frost3">v{pkg.version}</span>
                      <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">{pkg.name}</h3>
                      <PackageStatusBadge status={pkg.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-500 dark:text-nord-muted">Документы:</span>
                      {docTypes.map((dt) => <span key={dt} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-700 dark:bg-nord-1 dark:text-nord-4">{dt}</span>)}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                      <span>Профиль: <strong className="text-slate-700 dark:text-nord-4">{pkg.standardProfileId} ({pkg.standardProfileVersion})</strong></span>
                      <span aria-hidden>·</span><span>Генератор: {pkg.generatorVersion}</span><span aria-hidden>·</span>
                      <span>Выпущен: {new Date(pkg.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                      {pkg.approvedBy && <><span aria-hidden>·</span><span className="text-emerald-700 dark:text-emerald-400 font-semibold">Согласовал: {pkg.approvedBy}</span></>}
                    </div>

                    {pkg.reviewComment && <div className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><strong>Комментарий согласования:</strong> {pkg.reviewComment}</div>}

                    {pkg.checksum && <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 dark:text-nord-muted"><span>SHA-256:</span><span className="truncate max-w-md bg-slate-100 px-1.5 py-0.5 rounded dark:bg-nord-1">{pkg.checksum}</span></div>}
                  </div>

                  <div className="flex flex-col sm:items-end gap-2">
                    {pkg.calculation && (
                      <div className="text-xs text-slate-500 dark:text-nord-muted">
                        Привязан к расчёту: <Link href={`/calculations/${pkg.calculation.id}`} className="font-bold text-brand-700 hover:underline dark:text-nord-frost2">v{pkg.calculation.version} ({pkg.calculation.name})</Link>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {pkg.hasArtifact && <a href={`/api/gost34/packages/${pkg.id}/artifact`} download className="btn-secondary text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-nord-2" title="Скачать неизменяемый ZIP-архив выпуска с контрольной суммой SHA-256">⬇ Скачать ZIP</a>}
                      <button type="button" onClick={() => onShare(pkg)} className="btn-secondary text-xs font-bold" title="Сгенерировать share-ссылку для согласования Заказчиком">Поделиться</button>
                      {pkg.status === 'rejected' && pkg.calculation && <Link href={`/calculations/${pkg.calculation.id}/studio`} className="btn-primary !bg-rose-600 hover:!bg-rose-700 dark:!bg-nord-red text-xs font-bold">Исправить в Студии</Link>}
                      {pkg.status !== 'approved' && (canDecide ? (
                        <>
                          <button type="button" onClick={() => onReview(pkg, 'approve')} className="btn-secondary text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-nord-2" title="Утвердить данный выпуск">Согласовать</button>
                          <button type="button" onClick={() => onReview(pkg, 'reject')} className="btn-secondary text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-nord-2" title="Отклонить выпуск с комментарием">Отклонить</button>
                        </>
                      ) : <span className="text-xs text-slate-500 dark:text-nord-muted" title="Решение на текущем этапе выносит другая роль">на подписи: {REVIEW_STAGE_LABELS[stage] ?? 'ревью'}</span>)}
                      <Link href={`/calculations/${pkg.calculationId}`} className="btn-primary text-xs">В хаб →</Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
