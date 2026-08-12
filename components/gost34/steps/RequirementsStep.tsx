'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Gost34RequirementItem } from '@/lib/gost34/types';
import { normalizeRequirementItems } from '@/lib/gost34/parser/requirementSanitizer';
import type { PublicLlmProvider } from '@/lib/gost34/llm/providers';
import type { ValidationFinding } from '@/lib/gost34/validation/types';
import type { WizardReviewResult } from '@/lib/gost34/wizard/types';
import { PANEL_CLASS, SUBPANEL_CLASS } from '../wizardShared';

const CATEGORY_FILTERS = [
  { id: 'all', label: 'Все категории' },
  { id: 'functional', label: 'Функциональные' },
  { id: 'security', label: 'ИБ и безопасность' },
  { id: 'reliability', label: 'Надёжность и SLA' },
  { id: 'technical', label: 'Технические / ПО' },
];

const SEVERITY_STYLES: Record<string, string> = {
  ERROR: 'bg-red-500/15 text-red-300 border-red-500/40',
  WARNING: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  INFO: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

interface RequirementsStepProps {
  requirements: Gost34RequirementItem[];
  onRequirementsChange: (next: Gost34RequirementItem[]) => void;
  uploadedFiles: string[];
  onUploadedFilesChange: (next: string[]) => void;
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
}

export default function RequirementsStep({
  requirements,
  onRequirementsChange,
  uploadedFiles,
  onUploadedFilesChange,
  review,
  isReviewLoading,
}: RequirementsStepProps) {
  const [isParsing, setIsParsing] = useState(false);
  const [newReqCode, setNewReqCode] = useState('');
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqDesc, setNewReqDesc] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [uploadError, setUploadError] = useState('');

  /**
   * LLM configuration is server-side: the client picks a provider by id and
   * never sees or sends an endpoint or an API key.
   */
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [llmProviders, setLlmProviders] = useState<PublicLlmProvider[]>([]);
  const [llmProviderId, setLlmProviderId] = useState('');
  const [llmSelectedModel, setLlmSelectedModel] = useState('');
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmError, setLlmError] = useState('');
  const [isLlmNormalizing, setIsLlmNormalizing] = useState(false);

  const handleCheckLlmStatus = useCallback(
    async (providerId = llmProviderId) => {
      if (!providerId) return false;
      try {
        const query = new URLSearchParams({ providerId });
        const res = await fetch(`/api/gost34/llm-status?${query.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setLlmAvailable(false);
          setLlmError(data?.error || 'Не удалось проверить доступность ИИ-сервера.');
          return false;
        }
        setLlmError('');
        setLlmAvailable(Boolean(data.available));
        setLlmModels(data.models || []);
        if (data.models?.length > 0 && !llmSelectedModel) setLlmSelectedModel(data.models[0]);
        return data.available;
      } catch {
        setLlmAvailable(false);
        return false;
      }
    },
    [llmProviderId, llmSelectedModel],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/gost34/llm-providers');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLlmError(data?.error || 'ИИ-провайдеры недоступны.');
          setLlmProviders([]);
          return;
        }
        setLlmProviders(data.providers || []);
        setLlmProviderId(
          (current) => current || data.defaultProviderId || data.providers?.[0]?.id || '',
        );
      } catch {
        if (!cancelled) setLlmError('Не удалось получить список ИИ-провайдеров.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!llmProviderId) return;
    handleCheckLlmStatus(llmProviderId);
  }, [llmProviderId, handleCheckLlmStatus]);

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
    } catch (err: any) {
      setUploadError(`Не удалось распарсить файл: ${err?.message || 'Ошибка сервера'}`);
    } finally {
      setIsParsing(false);
      e.target.value = '';
    }
  };

  const handleLlmNormalize = async () => {
    if (requirements.length === 0) return;
    setIsLlmNormalizing(true);
    try {
      const res = await fetch('/api/gost34/normalize-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirements,
          providerId: llmProviderId,
          model: llmSelectedModel,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Ошибка при обработке ИИ-моделью');
      }

      const data = await res.json();
      if (Array.isArray(data.requirements) && data.requirements.length > 0) {
        onRequirementsChange(data.requirements);
      }
    } catch (err: any) {
      setLlmError(`Не удалось выполнить ИИ-нормализацию: ${err?.message || 'Ошибка ИИ'}`);
    } finally {
      setIsLlmNormalizing(false);
    }
  };

  const handleAddManualReq = () => {
    if (!newReqTitle.trim() || !newReqDesc.trim()) return;

    onRequirementsChange([
      ...requirements,
      {
        id: `req-manual-${Date.now()}`,
        code: newReqCode.trim() || `ТР-ВЕНД-${String(requirements.length + 1).padStart(2, '0')}`,
        category: 'functional',
        title: newReqTitle.trim(),
        description: newReqDesc.trim(),
        sourceFile: 'Ручной ввод',
      },
    ]);

    setNewReqCode('');
    setNewReqTitle('');
    setNewReqDesc('');
  };

  /** Замечания валидатора, привязанные к коду требования: строка таблицы их и показывает. */
  const findingsByCode = new Map<string, ValidationFinding[]>();
  for (const finding of review?.validation.findings || []) {
    const key = finding.requirementCode || '';
    findingsByCode.set(key, [...(findingsByCode.get(key) || []), finding]);
  }
  const summaryFindings = (review?.validation.byRequirement?.[''] || []) as ValidationFinding[];
  const counts = review?.validation.counts;

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
              Загрузка исходных спецификаций ТЗ / ФТ / ТТ
            </h4>
            <p className="text-xs text-slate-300 mt-1">
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

        <label className="cursor-pointer flex flex-col items-center justify-center p-7 rounded-xl border-2 border-dashed border-[#434c5e] hover:border-blue-400 bg-[#1c1f26] hover:bg-[#20242e] transition-all">
          <span className="text-3xl mb-2">📁</span>
          <span className="text-sm font-bold text-white">
            {isParsing
              ? 'Идёт обработка и анализ документа...'
              : 'Нажмите или перетащите файлы вендорского ТЗ сюда'}
          </span>
          <span className="text-xs text-slate-400 mt-1">
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
          <div className="flex flex-wrap gap-2 pt-2 border-t border-[#3b4252]">
            {uploadedFiles.map((fn, idx) => (
              <span
                key={`${fn}-${idx}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#2e3440] text-white border border-[#434c5e]"
              >
                📄 {fn}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Сводка валидатора ГОСТ 34 */}
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#3b4252] pb-3">
          <div>
            <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
              Проверка формулировок (ГОСТ 34.602)
            </h4>
            <p className="text-xs text-slate-300 mt-1">
              Единичность, однозначность, измеримость, проверяемость и наличие источника
            </p>
          </div>
          {counts && (
            <div className="flex items-center gap-2 text-[11px] font-bold">
              {(['ERROR', 'WARNING', 'INFO'] as const).map((severity) => (
                <span
                  key={severity}
                  className={`px-2.5 py-1 rounded-lg border ${SEVERITY_STYLES[severity]}`}
                >
                  {severity}: {counts[severity] || 0}
                </span>
              ))}
            </div>
          )}
        </div>

        {isReviewLoading && <div className="text-xs text-slate-400">Идёт проверка требований…</div>}

        {!isReviewLoading && summaryFindings.length > 0 && (
          <ul className="space-y-1.5">
            {summaryFindings.map((finding, idx) => (
              <li
                key={idx}
                className={`text-[11px] rounded-lg border px-3 py-2 ${SEVERITY_STYLES[finding.severity]}`}
              >
                <span className="font-bold uppercase mr-2">{finding.rule}</span>
                {finding.message}
              </li>
            ))}
          </ul>
        )}

        {!isReviewLoading && review && review.validation.findings.length === 0 && (
          <div className="text-xs text-emerald-300">Замечаний к формулировкам нет.</div>
        )}
      </div>

      {/* Таблица требований */}
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-[#3b4252] pb-3 gap-3">
          <div>
            <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
              Извлечённые требования ({requirements.length})
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              Нормализация не перезаписывает исходный текст: он хранится вместе с требованием
            </p>
          </div>

          {requirements.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRequirementsChange(normalizeRequirementItems(requirements))}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#2e3440] text-slate-200 border border-[#434c5e] hover:bg-[#3b4252] transition-colors"
                title="Удалить спецсимволы, буллеты и присвоить стандартные коды ГОСТ 34"
              >
                🧹 Очистить (правила)
              </button>

              <button
                type="button"
                onClick={handleLlmNormalize}
                disabled={isLlmNormalizing}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  llmAvailable
                    ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 border border-purple-400/40'
                    : 'bg-[#2e3440] text-slate-400 border border-[#434c5e] hover:bg-[#3b4252]'
                }`}
                title={
                  llmAvailable
                    ? 'ИИ предлагает нормализованную формулировку; оригинал остаётся неизменным'
                    : 'ИИ-сервер недоступен — проверьте настройки подключения'
                }
              >
                <span>
                  {isLlmNormalizing ? '⏳ Идёт обработка ИИ...' : '🤖 ИИ-предложения по тексту'}
                </span>
                {llmAvailable && !isLlmNormalizing && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowLlmSettings(!showLlmSettings)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#2e3440] text-slate-300 border border-[#434c5e] hover:text-white hover:bg-[#3b4252] transition-colors"
              >
                ⚙️ Настройки ИИ
              </button>

              <button
                type="button"
                onClick={() => onRequirementsChange([])}
                className="text-xs font-bold text-red-400 hover:text-red-300 hover:underline px-2 py-1"
              >
                Очистить список
              </button>
            </div>
          )}
        </div>

        {showLlmSettings && (
          <div className="bg-[#1c1f26] p-4 rounded-xl border border-purple-500/40 space-y-3">
            <div className="flex items-center justify-between border-b border-[#3b4252] pb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-purple-400">
                  ⚙️ Настройки ИИ-модели (Ollama / LM Studio / OpenAI)
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    llmAvailable
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-red-500/20 text-red-300 border border-red-500/40'
                  }`}
                >
                  {llmAvailable ? '✓ Сервер доступен' : '✕ Сервер недоступен'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCheckLlmStatus()}
                className="text-xs text-purple-300 hover:underline font-bold"
              >
                🔄 Проверить связь
              </button>
            </div>

            {llmError && (
              <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {llmError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[#a3be8c] text-[11px] font-bold mb-1">
                  Провайдер ИИ
                </label>
                <select
                  value={llmProviderId}
                  onChange={(e) => {
                    setLlmProviderId(e.target.value);
                    setLlmSelectedModel('');
                  }}
                  disabled={llmProviders.length === 0}
                  className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-1.5 text-white font-bold focus:border-purple-400 focus:outline-none disabled:opacity-50"
                >
                  {llmProviders.length === 0 && (
                    <option value="">Нет настроенных провайдеров</option>
                  )}
                  {llmProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#a3be8c] text-[11px] font-bold mb-1">
                  Модель нейросети
                </label>
                {llmModels.length > 0 ? (
                  <select
                    value={llmSelectedModel}
                    onChange={(e) => setLlmSelectedModel(e.target.value)}
                    className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-1.5 text-white font-bold focus:border-purple-400 focus:outline-none"
                  >
                    {llmModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={llmSelectedModel}
                    onChange={(e) => setLlmSelectedModel(e.target.value)}
                    placeholder="llama3.2 / qwen2.5 / local-model"
                    className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-1.5 text-white focus:border-purple-400 focus:outline-none"
                  />
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 pt-1 border-t border-[#3b4252]/60">
              Адреса ИИ-серверов и ключи доступа задаются на сервере (переменные окружения
              <code className="mx-1 text-slate-300">OLLAMA_HOST</code>,
              <code className="mx-1 text-slate-300">LMSTUDIO_HOST</code>,
              <code className="mx-1 text-slate-300">EVACAL_LLM_PROVIDERS</code>) и в браузер не
              передаются.
            </p>
          </div>
        )}

        {requirements.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {CATEGORY_FILTERS.map((cat) => {
              const count =
                cat.id === 'all'
                  ? requirements.length
                  : requirements.filter((r) => r.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                    categoryFilter === cat.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[#1c1f26] text-slate-300 hover:bg-[#2e3440] border border-[#3b4252]'
                  }`}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>
        )}

        {requirements.length === 0 ? (
          <div className="text-xs text-slate-400 italic p-6 text-center border border-dashed border-[#434c5e] rounded-xl bg-[#1c1f26]">
            Требования пока не извлечены. Загрузите файл ТЗ (.docx) выше или добавьте пункты
            вручную.
          </div>
        ) : (
          <div className={`max-h-72 overflow-y-auto ${SUBPANEL_CLASS}`}>
            <table className="w-full text-left text-xs">
              <thead className="bg-[#2e3440] text-white sticky top-0 border-b border-[#434c5e]">
                <tr>
                  <th className="p-3 w-32 font-bold text-blue-300">Код ГОСТ</th>
                  <th className="p-3 w-24 font-bold text-slate-300">Категория</th>
                  <th className="p-3 font-bold text-white">Формулировка и замечания</th>
                  <th className="p-3 w-28 font-bold text-slate-300">Источник</th>
                  <th className="p-3 w-12 text-center font-bold text-slate-300">Удалить</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e3440]">
                {requirements
                  .filter((r) => categoryFilter === 'all' || r.category === categoryFilter)
                  .map((req) => {
                    const findings = findingsByCode.get(req.code) || [];
                    return (
                      <tr key={req.id} className="hover:bg-[#282c37] transition-colors">
                        <td className="p-3 font-mono font-bold text-blue-400 align-top">
                          {req.code}
                        </td>
                        <td className="p-3 align-top">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              req.category === 'security'
                                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                : req.category === 'reliability'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : req.category === 'technical'
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            }`}
                          >
                            {req.category === 'security'
                              ? 'ИБ'
                              : req.category === 'reliability'
                                ? 'НАД'
                                : req.category === 'technical'
                                  ? 'ТЕХ'
                                  : 'ФУНК'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-100 break-words align-top space-y-1.5">
                          <div className="font-semibold text-white">{req.title}</div>
                          {req.title !== req.description && (
                            <div className="text-slate-300 text-[11px] leading-relaxed">
                              {req.description}
                            </div>
                          )}
                          {findings.map((finding, idx) => (
                            <div
                              key={idx}
                              className={`text-[10px] rounded border px-2 py-1 ${SEVERITY_STYLES[finding.severity]}`}
                            >
                              <span className="font-bold uppercase mr-1">{finding.rule}</span>
                              {finding.message}
                            </div>
                          ))}
                        </td>
                        <td className="p-3 text-slate-400 text-[11px] align-top space-y-1">
                          <div className="truncate">{req.sourceFile || '—'}</div>
                          {req.normalizedBy && (
                            <div
                              className="inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px]"
                              title={
                                req.originalText
                                  ? `Исходная формулировка: ${req.originalText}`
                                  : undefined
                              }
                            >
                              ИИ-предложение
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-center align-top">
                          <button
                            type="button"
                            onClick={() =>
                              onRequirementsChange(requirements.filter((r) => r.id !== req.id))
                            }
                            className="text-red-400 hover:text-red-300 font-bold text-sm px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pt-2">
          <label className="block text-xs font-bold text-slate-300 mb-2">
            Добавить требование вручную:
          </label>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input
              type="text"
              placeholder="Код (ТР-Ф-01)"
              value={newReqCode}
              onChange={(e) => setNewReqCode(e.target.value)}
              className="bg-[#1c1f26] border border-[#434c5e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Название пункта ТЗ"
              value={newReqTitle}
              onChange={(e) => setNewReqTitle(e.target.value)}
              className="bg-[#1c1f26] border border-[#434c5e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Полный текст требования"
              value={newReqDesc}
              onChange={(e) => setNewReqDesc(e.target.value)}
              className="bg-[#1c1f26] border border-[#434c5e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddManualReq}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg px-4 py-2 text-xs shadow-md transition-all"
            >
              + Добавить пункт
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
