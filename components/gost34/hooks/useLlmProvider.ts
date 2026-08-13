import { useState, useEffect, useCallback } from 'react';
import type { PublicLlmProvider } from '@/lib/gost34/llm/providers';
import type { Gost34RequirementItem } from '@/lib/gost34/types';

export function useLlmProvider() {
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [llmProviders, setLlmProviders] = useState<PublicLlmProvider[]>([]);
  const [llmProviderId, setLlmProviderId] = useState('');
  const [llmSelectedModel, setLlmSelectedModel] = useState('');
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmError, setLlmError] = useState('');
  const [isLlmNormalizing, setIsLlmNormalizing] = useState(false);

  const checkLlmStatus = useCallback(
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
        if (data.models?.length > 0 && !llmSelectedModel) {
          setLlmSelectedModel(data.models[0]);
        }
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
    checkLlmStatus(llmProviderId);
  }, [llmProviderId, checkLlmStatus]);

  const normalizeWithLlm = async (
    requirements: Gost34RequirementItem[],
  ): Promise<Gost34RequirementItem[] | null> => {
    if (requirements.length === 0) return null;
    setIsLlmNormalizing(true);
    setLlmError('');
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
        return data.requirements as Gost34RequirementItem[];
      }
      return null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка ИИ';
      setLlmError(`Не удалось выполнить ИИ-нормализацию: ${msg}`);
      return null;
    } finally {
      setIsLlmNormalizing(false);
    }
  };

  return {
    showLlmSettings,
    setShowLlmSettings,
    llmProviders,
    llmProviderId,
    setLlmProviderId,
    llmSelectedModel,
    setLlmSelectedModel,
    llmAvailable,
    llmModels,
    llmError,
    setLlmError,
    isLlmNormalizing,
    checkLlmStatus,
    normalizeWithLlm,
  };
}
