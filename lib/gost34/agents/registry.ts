import { prisma } from '@/lib/prisma';
import { getEndpointPolicy } from '../llm/providers';
import { assertAllowedEndpoint } from '../llm/endpointGuard';
import {
  HARNESS_AGENT_MODES,
  HarnessAgentMode,
  PublicHarnessAgent,
  isHarnessAgentMode,
} from './types';

/**
 * Реестр харнесс-агентов. Агент принадлежит пользователю: архитектор видит и
 * запускает только свои, админ — все (для сопровождения). Endpoint проходит ту
 * же SSRF-защиту, что и LLM-провайдеры, при каждом сохранении и запуске.
 */

const MAX_AGENTS_PER_USER = 20;

type DbHarnessAgent = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  endpoint: string;
  authToken: string | null;
  modes: string;
  enabled: boolean;
  lastStatus: string | null;
  lastRunAt: Date | null;
  owner?: { username: string };
};

export function parseModes(raw: string | null | undefined): HarnessAgentMode[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      const modes = parsed.filter(isHarnessAgentMode);
      if (modes.length > 0) return [...new Set(modes)];
    }
  } catch {
    // повреждённое значение трактуем как режим по умолчанию
  }
  return ['review'];
}

export function toPublicAgent(agent: DbHarnessAgent): PublicHarnessAgent {
  return {
    id: agent.id,
    ownerId: agent.ownerId,
    ownerName: agent.owner?.username,
    name: agent.name,
    description: agent.description,
    endpoint: agent.endpoint,
    hasAuthToken: !!agent.authToken,
    modes: parseModes(agent.modes),
    enabled: agent.enabled,
    lastStatus: agent.lastStatus,
    lastRunAt: agent.lastRunAt ? agent.lastRunAt.toISOString() : null,
  };
}

export class HarnessAgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessAgentValidationError';
  }
}

export interface HarnessAgentInput {
  name?: unknown;
  description?: unknown;
  endpoint?: unknown;
  authToken?: unknown;
  modes?: unknown;
  enabled?: unknown;
}

/**
 * Валидирует пользовательский ввод. `partial` — для PATCH: отсутствующие поля
 * не трогаются. Endpoint валидируется здесь же, чтобы недопустимый адрес нельзя
 * было даже сохранить.
 */
export function validateAgentInput(input: HarnessAgentInput, partial = false) {
  const data: {
    name?: string;
    description?: string | null;
    endpoint?: string;
    authToken?: string | null;
    modes?: string;
    enabled?: boolean;
  } = {};

  if (input.name !== undefined || !partial) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new HarnessAgentValidationError('Укажите название агента.');
    if (name.length > 120) throw new HarnessAgentValidationError('Название длиннее 120 символов.');
    data.name = name;
  }

  if (input.description !== undefined) {
    const description = String(input.description ?? '').trim();
    if (description.length > 500) {
      throw new HarnessAgentValidationError('Описание длиннее 500 символов.');
    }
    data.description = description || null;
  }

  if (input.endpoint !== undefined || !partial) {
    const raw = String(input.endpoint ?? '').trim();
    if (!raw) throw new HarnessAgentValidationError('Укажите endpoint агента.');
    data.endpoint = assertAllowedEndpoint(raw, getEndpointPolicy());
  }

  if (input.authToken !== undefined) {
    const token = String(input.authToken ?? '').trim();
    if (token.length > 2000) throw new HarnessAgentValidationError('Токен слишком длинный.');
    data.authToken = token || null;
  }

  if (input.modes !== undefined || !partial) {
    const raw = Array.isArray(input.modes) ? input.modes : ['review'];
    const modes = [...new Set(raw.filter(isHarnessAgentMode))];
    if (modes.length === 0) {
      throw new HarnessAgentValidationError(
        `Выберите хотя бы один режим: ${HARNESS_AGENT_MODES.join(', ')}.`,
      );
    }
    data.modes = JSON.stringify(modes);
  }

  if (input.enabled !== undefined) {
    data.enabled = !!input.enabled;
  }

  return data;
}

const OWNER_INCLUDE = { owner: { select: { username: true } } } as const;

/** Агенты, которыми пользователь управляет: свои, а для админа — все. */
export async function listAgentsFor(userId: string, isAdmin: boolean) {
  const agents = await prisma.harnessAgent.findMany({
    where: isAdmin ? {} : { ownerId: userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: OWNER_INCLUDE,
  });
  return agents.map(toPublicAgent);
}

/** Возвращает запись агента, если пользователь вправе ей распоряжаться. */
export async function getManagedAgent(agentId: string, userId: string, isAdmin: boolean) {
  const agent = await prisma.harnessAgent.findUnique({
    where: { id: agentId },
    include: OWNER_INCLUDE,
  });
  if (!agent) return null;
  if (!isAdmin && agent.ownerId !== userId) return null;
  return agent;
}

export async function createAgent(ownerId: string, input: HarnessAgentInput) {
  const count = await prisma.harnessAgent.count({ where: { ownerId } });
  if (count >= MAX_AGENTS_PER_USER) {
    throw new HarnessAgentValidationError(
      `Не больше ${MAX_AGENTS_PER_USER} агентов на пользователя.`,
    );
  }
  const data = validateAgentInput(input);
  const agent = await prisma.harnessAgent.create({
    data: {
      ownerId,
      name: data.name!,
      description: data.description ?? null,
      endpoint: data.endpoint!,
      authToken: data.authToken ?? null,
      modes: data.modes!,
      enabled: data.enabled ?? true,
    },
    include: OWNER_INCLUDE,
  });
  return toPublicAgent(agent);
}
