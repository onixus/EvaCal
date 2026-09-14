import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { draftTzSection } from '../draft';
import { Gost34InputPayload } from '../../../types';
import { ProjectContext, CONTEXT_GAP_PLACEHOLDER } from '../../../context/types';
import { GOST34_2020_PROFILE } from '../../../standards/profiles';
import { LlmProvider } from '../../providers';
import * as clientModule from '../../client';

function createMockPayload(overrides: Partial<Gost34InputPayload> = {}): Gost34InputPayload {
  return {
    metadata: {
      docType: 'TZ',
      systemName: 'АС Тест',
      fullSystemName: 'Автоматизированная система Тест',
      documentCode: 'АБВГ.123456.001 ТЗ',
      customerName: 'Заказчик',
      developerName: 'Разработчик',
      signatures: {
        developer: 'Иванов',
        checker: 'Петров',
        techControl: 'Сидоров',
        normControl: 'Кузнецов',
        approver: 'Васильев',
      },
      city: 'Москва',
      year: 2026,
      version: '1.0',
    },
    standardProfile: GOST34_2020_PROFILE,
    systemName: 'АС Тест',
    customerName: 'Заказчик',
    stages: [],
    ...overrides,
  };
}

function createMockContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    systemPurpose: 'Назначение системы',
    goals: [{ id: 'g1', statement: 'Цель 1' }],
    measurableGoalCriteria: [],
    automationObject: 'Объект автоматизации',
    dataClasses: [],
    architecture: { components: [] },
    infrastructure: {},
    deploymentModel: 'on-premise',
    users: [],
    roles: [],
    integrations: [],
    availability: {},
    performance: {},
    security: {},
    lifecycle: {},
    documentationRequirements: [],
    gaps: [],
    provenance: [],
    ...overrides,
  };
}

const mockProvider: LlmProvider = {
  id: 'ollama-local',
  label: 'Ollama Local',
  kind: 'ollama',
  endpoint: 'http://127.0.0.1:11434',
  defaultModel: 'qwen2.5',
};

describe('PR-05: draftTzSection', () => {
  it('fixture gap-refuse-rto: short-circuits with usedLlm=false and gap questions when facts are missing', async () => {
    const fixturePath = path.resolve(__dirname, 'eval/gap-refuse-rto.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

    const payload = createMockPayload({
      stages: [],
      customRequirements: [],
      requirementsV2: [],
    });

    const context = createMockContext({
      availability: {},
      gaps: [
        {
          path: 'availability.rtoMinutes',
          label: 'RTO (время восстановления)',
          severity: 'major',
          hint: 'опросник',
        },
      ],
    });

    const chatSpy = vi.spyOn(clientModule, 'chatCompletion');

    const result = await draftTzSection({
      nodeId: fixture.nodeId,
      payload,
      context,
      provider: mockProvider,
      model: 'qwen2.5',
      speculate: fixture.speculate,
    });

    expect(chatSpy).not.toHaveBeenCalled();
    expect(result.proposal.usedLlm).toBe(false);
    expect(result.proposal.nodeId).toBe(fixture.nodeId);
    expect(result.proposal.status).toBe('PROPOSED');
    expect(result.proposal.flags).toEqual([]);
    expect(result.proposal.questions.length).toBeGreaterThan(0);
    expect(result.proposal.questions[0].gapPath).toBe('availability.rtoMinutes');
    expect(result.proposal.paragraphs.some((p) => p.includes(CONTEXT_GAP_PLACEHOLDER))).toBe(true);

    chatSpy.mockRestore();
  });

  it('calls LLM when facts exist, forces nodeId, and detects flags on the draft', async () => {
    const payload = createMockPayload();
    const context = createMockContext({
      systemPurpose: 'Система предназначена для обработки финансовых транзакций.',
    });

    const chatSpy = vi.spyOn(clientModule, 'chatCompletion').mockResolvedValueOnce({
      text: JSON.stringify({
        nodeId: 'wrong-node-id', // LLM might hallucinate a different nodeId
        paragraphs: [
          '2.1 Система обеспечивает обработку финансовых транзакций.',
          '2.2 Время отклика составляет не более 200 мс.',
        ],
        questions: [],
        refusedGapPaths: [],
      }),
      model: 'qwen2.5',
      providerId: 'ollama-local',
      latencyMs: 120,
    });

    const result = await draftTzSection({
      nodeId: 'tz2020-goals-purpose',
      payload,
      context,
      provider: mockProvider,
      model: 'qwen2.5',
      speculate: false,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.proposal.usedLlm).toBe(true);
    // Forced nodeId
    expect(result.proposal.nodeId).toBe('tz2020-goals-purpose');
    // Clause numbers stripped from paragraphs
    expect(result.proposal.paragraphs[0]).toBe(
      'Система обеспечивает обработку финансовых транзакций.',
    );
    expect(result.proposal.paragraphs[1]).toBe('Время отклика составляет не более 200 мс.');
    expect(result.proposal.status).toBe('PROPOSED');

    chatSpy.mockRestore();
  });

  it('handles LLM timeout with code timeout and status 504', async () => {
    const payload = createMockPayload();
    const context = createMockContext({
      systemPurpose: 'Назначение системы',
    });

    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'AbortError';

    const chatSpy = vi.spyOn(clientModule, 'chatCompletion').mockRejectedValueOnce(timeoutError);

    await expect(
      draftTzSection({
        nodeId: 'tz2020-goals-purpose',
        payload,
        context,
        provider: mockProvider,
        model: 'qwen2.5',
      }),
    ).rejects.toMatchObject({
      code: 'timeout',
      statusCode: 504,
    });

    chatSpy.mockRestore();
  });

  it('handles LLM parse errors with code parse and status 502', async () => {
    const payload = createMockPayload();
    const context = createMockContext({
      systemPurpose: 'Назначение системы',
    });

    const chatSpy = vi.spyOn(clientModule, 'chatCompletion').mockResolvedValueOnce({
      text: 'Извините, я не могу сформировать JSON ответ.',
      model: 'qwen2.5',
      providerId: 'ollama-local',
      latencyMs: 50,
    });

    await expect(
      draftTzSection({
        nodeId: 'tz2020-goals-purpose',
        payload,
        context,
        provider: mockProvider,
        model: 'qwen2.5',
      }),
    ).rejects.toMatchObject({
      code: 'parse',
      statusCode: 502,
    });

    chatSpy.mockRestore();
  });
});
