'use client';

import type { PublicLlmProvider } from '@/lib/gost34/llm/providers';

interface LlmSettingsPanelProps {
  llmAvailable: boolean;
  llmError: string;
  llmProviders: PublicLlmProvider[];
  llmProviderId: string;
  setLlmProviderId: (id: string) => void;
  llmModels: string[];
  llmSelectedModel: string;
  setLlmSelectedModel: (model: string) => void;
  onCheckStatus: () => void;
}

export default function LlmSettingsPanel({
  llmAvailable,
  llmError,
  llmProviders,
  llmProviderId,
  setLlmProviderId,
  llmModels,
  llmSelectedModel,
  setLlmSelectedModel,
  onCheckStatus,
}: LlmSettingsPanelProps) {
  return (
    <div className="bg-slate-50 dark:bg-nord-1 p-4 rounded-xl border border-purple-500/40 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-nord-3 pb-2">
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
          onClick={onCheckStatus}
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
          <label className="block text-emerald-600 dark:text-nord-green text-[11px] font-bold mb-1">
            Провайдер ИИ
          </label>
          <select
            value={llmProviderId}
            onChange={(e) => {
              setLlmProviderId(e.target.value);
              setLlmSelectedModel('');
            }}
            disabled={llmProviders.length === 0}
            className="w-full bg-white dark:bg-nord-2 border border-slate-300 dark:border-nord-3 rounded-lg px-3 py-1.5 text-slate-900 dark:text-nord-6 font-bold focus:border-purple-400 focus:outline-none disabled:opacity-50"
          >
            {llmProviders.length === 0 && <option value="">Нет настроенных провайдеров</option>}
            {llmProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-emerald-600 dark:text-nord-green text-[11px] font-bold mb-1">
            Модель нейросети
          </label>
          {llmModels.length > 0 ? (
            <select
              value={llmSelectedModel}
              onChange={(e) => setLlmSelectedModel(e.target.value)}
              className="w-full bg-white dark:bg-nord-2 border border-slate-300 dark:border-nord-3 rounded-lg px-3 py-1.5 text-slate-900 dark:text-nord-6 font-bold focus:border-purple-400 focus:outline-none"
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
              className="w-full bg-white dark:bg-nord-2 border border-slate-300 dark:border-nord-3 rounded-lg px-3 py-1.5 text-slate-900 dark:text-nord-6 focus:border-purple-400 focus:outline-none"
            />
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-nord-muted pt-1 border-t border-slate-200 dark:border-nord-3/60">
        Адреса ИИ-серверов и ключи доступа задаются на сервере (переменные окружения
        <code className="mx-1 text-slate-600 dark:text-nord-4">OLLAMA_HOST</code>,
        <code className="mx-1 text-slate-600 dark:text-nord-4">LMSTUDIO_HOST</code>,
        <code className="mx-1 text-slate-600 dark:text-nord-4">EVACAL_LLM_PROVIDERS</code>) и в
        браузер не передаются.
      </p>
    </div>
  );
}
