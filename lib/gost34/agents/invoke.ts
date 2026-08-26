import { prisma } from '@/lib/prisma';
import { getEndpointPolicy } from '../llm/providers';
import { assertAllowedEndpoint } from '../llm/endpointGuard';
import {
  HarnessAgentMode,
  HarnessAgentRequest,
  HarnessAgentResult,
  HarnessFinding,
  HarnessPatch,
} from './types';

/**
 * Вызов харнесс-агента. Ответ агента — недоверенные данные с чужого сервера:
 * здесь он нормализуется (типы, лимиты на количество и длину), а решение о
 * применении патчей всегда остаётся за человеком в UI.
 */

const AGENT_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_FINDINGS = 200;
const MAX_PATCHES = 100;
const MAX_TEXT = 2000;

function clipText(value: unknown, max = MAX_TEXT): string {
  return String(value ?? '').slice(0, max);
}

function normalizeFindings(raw: unknown): HarnessFinding[] {
  if (!Array.isArray(raw)) return [];
  const findings: HarnessFinding[] = [];
  for (const entry of raw.slice(0, MAX_FINDINGS)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const message = clipText(e.message).trim();
    if (!message) continue;
    const severity =
      e.severity === 'error' || e.severity === 'warning' || e.severity === 'info'
        ? e.severity
        : 'info';
    findings.push({
      severity,
      message,
      path: e.path ? clipText(e.path, 300) : undefined,
    });
  }
  return findings;
}

function normalizePatches(raw: unknown): HarnessPatch[] {
  if (!Array.isArray(raw)) return [];
  const patches: HarnessPatch[] = [];
  for (const entry of raw.slice(0, MAX_PATCHES)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const path = clipText(e.path, 300).trim();
    if (!path || e.value === undefined) continue;
    patches.push({
      path,
      value: e.value,
      rationale: e.rationale ? clipText(e.rationale) : undefined,
    });
  }
  return patches;
}

interface InvokableAgent {
  id: string;
  name: string;
  endpoint: string;
  authToken: string | null;
}

export async function invokeHarnessAgent(
  agent: InvokableAgent,
  mode: HarnessAgentMode | 'ping',
  payload: unknown,
): Promise<HarnessAgentResult> {
  const started = Date.now();

  const base: Omit<HarnessAgentResult, 'ok' | 'error'> = {
    agentId: agent.id,
    agentName: agent.name,
    mode,
    findings: [],
    patches: [],
    durationMs: 0,
  };

  const fail = async (error: string): Promise<HarnessAgentResult> => {
    await recordRun(agent.id, error);
    return { ...base, ok: false, error, durationMs: Date.now() - started };
  };

  // Повторная проверка на случай, если политика ужесточилась после сохранения.
  let endpoint: string;
  try {
    endpoint = assertAllowedEndpoint(agent.endpoint, getEndpointPolicy());
  } catch (e: any) {
    return fail(e?.message || 'Endpoint агента не разрешён.');
  }

  const request: HarnessAgentRequest = {
    version: 1,
    mode,
    agent: { id: agent.id, name: agent.name },
    payload,
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent.authToken) headers.Authorization = `Bearer ${agent.authToken}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (e: any) {
    const reason = e?.name === 'TimeoutError' ? `Таймаут ${AGENT_TIMEOUT_MS / 1000} с` : e?.message;
    return fail(`Агент недоступен: ${reason || 'ошибка сети'}`);
  }

  if (!response.ok) {
    return fail(`Агент ответил HTTP ${response.status}`);
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return fail('Не удалось прочитать ответ агента.');
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    return fail('Ответ агента больше 1 МБ.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('Агент вернул не-JSON ответ.');
  }

  await recordRun(agent.id, 'ok');
  return {
    ...base,
    ok: true,
    summary: parsed?.summary ? clipText(parsed.summary) : undefined,
    findings: normalizeFindings(parsed?.findings),
    patches: normalizePatches(parsed?.patches),
    durationMs: Date.now() - started,
  };
}

/** Диагностика в реестре важнее строгой атомарности: ошибки записи глотаем. */
async function recordRun(agentId: string, status: string): Promise<void> {
  try {
    await prisma.harnessAgent.update({
      where: { id: agentId },
      data: { lastStatus: status.slice(0, 500), lastRunAt: new Date() },
    });
  } catch {
    // агент мог быть удалён параллельно — результат вызова всё равно возвращаем
  }
}
