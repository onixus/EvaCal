/**
 * Харнесс-агенты — внешние сервисы ревью и обогащения, которые архитектор или
 * ГИП подключает самостоятельно (в отличие от LLM-провайдеров из
 * `../llm/providers.ts`, которые задаются деплоем через env).
 *
 * Контракт вызова: платформа шлёт POST JSON на endpoint агента, агент отвечает
 * находками (`findings`) и/или предложениями обогащения (`patches`). Ответ
 * агента — недоверенные данные: он нормализуется и обрезается, а не
 * применяется автоматически.
 */

export type HarnessAgentMode = 'review' | 'enrichment';

export const HARNESS_AGENT_MODES: HarnessAgentMode[] = ['review', 'enrichment'];

export function isHarnessAgentMode(value: unknown): value is HarnessAgentMode {
  return value === 'review' || value === 'enrichment';
}

/** Представление агента, безопасное для клиента: без authToken. */
export interface PublicHarnessAgent {
  id: string;
  ownerId: string;
  ownerName?: string;
  name: string;
  description: string | null;
  endpoint: string;
  hasAuthToken: boolean;
  modes: HarnessAgentMode[];
  enabled: boolean;
  lastStatus: string | null;
  lastRunAt: string | null;
}

/** Тело запроса, которое платформа отправляет агенту. */
export interface HarnessAgentRequest {
  version: 1;
  mode: HarnessAgentMode | 'ping';
  agent: { id: string; name: string };
  /** Контекст комплекта: результат мастера ревью либо произвольный вход. */
  payload: unknown;
}

export type HarnessFindingSeverity = 'info' | 'warning' | 'error';

export interface HarnessFinding {
  severity: HarnessFindingSeverity;
  message: string;
  /** Путь до элемента комплекта, например "requirements[3]" или "stages.s2". */
  path?: string;
}

export interface HarnessPatch {
  path: string;
  value: unknown;
  rationale?: string;
}

/** Нормализованный ответ агента. */
export interface HarnessAgentResult {
  agentId: string;
  agentName: string;
  mode: HarnessAgentMode | 'ping';
  ok: boolean;
  /** Текст ошибки, если ok=false. */
  error?: string;
  summary?: string;
  findings: HarnessFinding[];
  patches: HarnessPatch[];
  durationMs: number;
}
