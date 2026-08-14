'use client';

import { useState, useEffect } from 'react';
import { Gost34Section } from '@/lib/gost34/types';

interface SpecificationPanelProps {
  calculationId: string;
  calculationName: string;
  customerName: string;
  answers: Record<string, unknown>;
  onOpenGostWizard?: () => void;
}

export default function SpecificationPanel({
  calculationId,
  calculationName,
  customerName,
  answers,
  onOpenGostWizard,
}: SpecificationPanelProps) {
  const [sections, setSections] = useState<Gost34Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    async function loadSpec() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/gost34/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calculationId,
            docType: 'SPEC',
          }),
        });

        if (!res.ok) {
          throw new Error('Не удалось сформировать спецификацию оборудования и ПО');
        }

        const data = await res.json();
        if (!isCancelled && data.ast?.sections) {
          setSections(data.ast.sections);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Ошибка загрузки спецификации');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadSpec();
    return () => {
      isCancelled = true;
    };
  }, [calculationId]);

  const handleDownloadDocx = async () => {
    setDownloadingDocx(true);
    try {
      const res = await fetch(`/api/calculations/${calculationId}/gost34`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: 'SPEC',
        }),
      });

      if (!res.ok) {
        throw new Error('Ошибка скачивания спецификации DOCX');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Спецификация_${calculationName.replace(/\s+/g, '_')}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Не удалось скачать DOCX');
    } finally {
      setDownloadingDocx(false);
    }
  };

  const swTable = sections[1]?.tables?.[0];
  const hwTable = sections[2]?.tables?.[0];
  const passiveTable = sections[3]?.tables?.[0];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="card border border-slate-200/80 bg-white p-6 shadow-sm dark:border-nord-3 dark:bg-nord-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📦</span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-nord-6">
                Спецификация оборудования и программного обеспечения
              </h2>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-nord-frost3/20 dark:text-nord-frost3">
                188-ФЗ / ПП РФ № 878
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-nord-muted">
              Ведомость лицензий, реестровых номеров ПО, серверных платформ YADRO/Aquarius, СХД и
              комплектов ЗИП
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleDownloadDocx}
              disabled={downloadingDocx || loading}
              className="btn-primary flex items-center gap-1.5 text-xs font-semibold"
            >
              <span>{downloadingDocx ? '⏳ Генерация...' : '📄 Скачать DOCX (Спецификация)'}</span>
            </button>
            {onOpenGostWizard && (
              <button
                onClick={onOpenGostWizard}
                className="btn-secondary flex items-center gap-1.5 text-xs font-semibold"
              >
                <span>🚀 Выпустить в мастере ГОСТ 34</span>
              </button>
            )}
          </div>
        </div>

        {/* Metric Cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/50">
            <div className="text-xs font-medium text-slate-500 dark:text-nord-muted">
              Программные продукты и СЗИ
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900 dark:text-nord-6">
              {swTable?.rows.length || 0} поз.
            </div>
            <div className="mt-1 text-[11px] text-emerald-600 dark:text-nord-frost3">
              Реестр Минцифры (188-ФЗ)
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/50">
            <div className="text-xs font-medium text-slate-500 dark:text-nord-muted">
              Серверы, СХД и ПАК
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900 dark:text-nord-6">
              {hwTable?.rows.length || 0} поз.
            </div>
            <div className="mt-1 text-[11px] text-blue-600 dark:text-nord-frost2">
              Реестр Минпромторга РФ
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/50">
            <div className="text-xs font-medium text-slate-500 dark:text-nord-muted">
              Сертификация СЗИ/СКЗИ
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900 dark:text-nord-6">
              ФСТЭК / ФСБ
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-nord-muted">
              Формуляры и знаки соответствия
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/50">
            <div className="text-xs font-medium text-slate-500 dark:text-nord-muted">
              Гарантия и техподдержка
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900 dark:text-nord-6">36 мес.</div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-nord-muted">
              SLA 8x5 / 24x7 NBD
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center text-slate-500 dark:text-nord-muted">
          <div className="animate-pulse text-sm">
            Формирование спецификации по базам реестров РФ...
          </div>
        </div>
      ) : error ? (
        <div className="card border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <div className="font-semibold">Ошибка загрузки спецификации:</div>
          <div className="mt-1 text-sm">{error}</div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Table 1: Software & Licenses */}
          {swTable && (
            <div className="card overflow-hidden border border-slate-200/80 bg-white shadow-sm dark:border-nord-3 dark:bg-nord-2">
              <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/40">
                <h3 className="font-semibold text-slate-900 dark:text-nord-6">{swTable.caption}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-100/70 font-semibold text-slate-700 dark:border-nord-3 dark:bg-nord-1 dark:text-nord-4">
                    <tr>
                      {swTable.headers.map((h, i) => (
                        <th key={i} className="px-4 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-nord-3 dark:text-nord-4">
                    {swTable.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/60 dark:hover:bg-nord-1/30">
                        <td className="px-4 py-3 font-medium">{row[0]}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-nord-6">
                          {row[1]}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-nord-muted">{row[2]}</td>
                        <td className="px-4 py-3 font-mono font-medium text-emerald-700 dark:text-nord-frost3">
                          {row[3]}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-slate-600 dark:text-nord-muted">
                          {row[4]}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-nord-muted">{row[5]}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-nord-6">
                          {row[6]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Table 2: Hardware & PAC */}
          {hwTable && (
            <div className="card overflow-hidden border border-slate-200/80 bg-white shadow-sm dark:border-nord-3 dark:bg-nord-2">
              <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/40">
                <h3 className="font-semibold text-slate-900 dark:text-nord-6">{hwTable.caption}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-100/70 font-semibold text-slate-700 dark:border-nord-3 dark:bg-nord-1 dark:text-nord-4">
                    <tr>
                      {hwTable.headers.map((h, i) => (
                        <th key={i} className="px-4 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-nord-3 dark:text-nord-4">
                    {hwTable.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/60 dark:hover:bg-nord-1/30">
                        <td className="px-4 py-3 font-medium">{row[0]}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-nord-6">
                          {row[1]}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-nord-muted">
                          {row[2]}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-nord-muted">{row[3]}</td>
                        <td className="px-4 py-3 text-[11px] text-slate-600 dark:text-nord-muted">
                          {row[4]}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-nord-4">
                          {row[5]}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-nord-6">
                          {row[6]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Table 3: Passive Equipment & Racks */}
          {passiveTable && (
            <div className="card overflow-hidden border border-slate-200/80 bg-white shadow-sm dark:border-nord-3 dark:bg-nord-2">
              <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/40">
                <h3 className="font-semibold text-slate-900 dark:text-nord-6">
                  {passiveTable.caption}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-100/70 font-semibold text-slate-700 dark:border-nord-3 dark:bg-nord-1 dark:text-nord-4">
                    <tr>
                      {passiveTable.headers.map((h, i) => (
                        <th key={i} className="px-4 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-nord-3 dark:text-nord-4">
                    {passiveTable.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/60 dark:hover:bg-nord-1/30">
                        <td className="px-4 py-3 font-medium">{row[0]}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-nord-6">
                          {row[1]}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-nord-muted">{row[2]}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-nord-6">
                          {row[3]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Delivery & Documentation Requirements */}
          {sections[4] && (
            <div className="card border border-slate-200/80 bg-slate-50/60 p-6 dark:border-nord-3 dark:bg-nord-1/40">
              <h3 className="font-semibold text-slate-900 dark:text-nord-6">{sections[4].title}</h3>
              <div className="mt-3 space-y-2 text-xs text-slate-600 dark:text-nord-muted">
                {sections[4].paragraphs.map((p, pIdx) => (
                  <p key={pIdx}>{p}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
