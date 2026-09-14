import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { detectDraftFlags, isHardFlag } from '../flags';
import { draftTzSection } from '../draft';
import { GroundingPack } from '../grounding';
import { GOST34_2020_PROFILE } from '../../../standards/profiles';
import { Gost34InputPayload } from '../../../types';
import { ProjectContext } from '../../../context/types';
import { LlmProvider } from '../../providers';

describe('PR-09: TZ Author Eval Suite (Deterministic CI Evaluation Gate)', () => {
  const evalDir = path.resolve(__dirname, 'eval');
  const allFixtureFiles = fs.readdirSync(evalDir).filter((f) => f.endsWith('.json'));

  it('contains all 13 evaluation fixtures in the eval catalog', () => {
    expect(allFixtureFiles.length).toBe(13);
  });

  describe('Fact-diff Flag Fixtures (12 fixtures)', () => {
    const flagFixtures = allFixtureFiles.filter((f) => f !== 'gap-refuse-rto.json');

    for (const fileName of flagFixtures) {
      it(`eval fixture: ${fileName}`, () => {
        const raw = fs.readFileSync(path.join(evalDir, fileName), 'utf-8');
        const fixture = JSON.parse(raw);

        const pack: GroundingPack = fixture.pack;
        const baseline: string[] = fixture.baselineParagraphs || [];
        const draft: string[] = fixture.draftParagraphs || [];
        const expectedCodes: string[] = fixture.expectedFlagCodes || [];
        const expectedSeverities: string[] | undefined = fixture.expectedSeverities;

        const flags = detectDraftFlags(pack, baseline, draft);
        const actualCodes = flags.map((f) => f.code);

        expect(actualCodes).toEqual(expectedCodes);

        if (expectedSeverities) {
          const actualSeverities = flags.map((f) => f.severity);
          expect(actualSeverities).toEqual(expectedSeverities);
        }

        // Verify hard flag classification consistency
        for (const flag of flags) {
          if (flag.severity === 'block') {
            expect(isHardFlag(flag)).toBe(true);
          }
        }
      });
    }
  });

  describe('Gap Refusal Fixture (gap-refuse-rto.json)', () => {
    it('refuses LLM generation when required grounding facts are missing and speculate=false', async () => {
      const raw = fs.readFileSync(path.join(evalDir, 'gap-refuse-rto.json'), 'utf-8');
      const fixture = JSON.parse(raw);

      const mockPayload: Gost34InputPayload = {
        metadata: {
          docType: 'TZ',
          systemName: 'АС Тест',
          fullSystemName: 'Автоматизированная система Тест',
          documentCode: 'АБВГ.123456.001 ТЗ',
          customerName: 'Заказчик',
          developerName: 'Разработчик',
          signatures: {
            developer: 'Разработчик',
            checker: 'Проверяющий',
            techControl: 'Т.Контр',
            normControl: 'Н.Контр',
            approver: 'Утверждающий',
          },
          city: 'Москва',
          year: 2026,
          version: '1.0',
        },
        standardProfile: GOST34_2020_PROFILE,
        systemName: 'АС Тест',
        customerName: 'Заказчик',
        stages: [],
      };

      // Empty availability context -> triggers gap refusal
      const mockContext: ProjectContext = {
        systemPurpose: 'Назначение',
        goals: [],
        measurableGoalCriteria: [],
        automationObject: 'Объект',
        dataClasses: [],
        architecture: { components: [] },
        infrastructure: {},
        deploymentModel: 'on-premise',
        users: [],
        roles: [],
        integrations: [],
        availability: {}, // missing rtoMinutes, availabilityTargetPercent
        performance: {},
        security: {},
        lifecycle: {},
        documentationRequirements: [],
        gaps: [
          {
            path: 'availability.rtoMinutes',
            label: 'Допустимое время восстановления (RTO)',
            severity: 'blocking',
          },
        ],
        provenance: [],
      };

      const mockProvider: LlmProvider = {
        id: 'ollama-local',
        label: 'Ollama Local',
        kind: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        defaultModel: 'qwen2.5:14b',
      };

      const result = await draftTzSection({
        nodeId: fixture.nodeId,
        payload: mockPayload,
        context: mockContext,
        provider: mockProvider,
        model: 'qwen2.5:14b',
        speculate: fixture.speculate,
      });

      expect(result.proposal.usedLlm).toBe(fixture.expectedUsedLlm);
      expect(result.proposal.flags).toEqual(fixture.expectedFlags);
      expect(result.proposal.refusedGapPaths).toContain(fixture.expectedQuestionGapPath);
      expect(result.proposal.questions.length).toBeGreaterThan(0);
      expect(
        result.proposal.questions.some((q) => q.gapPath === fixture.expectedQuestionGapPath),
      ).toBe(true);
    });
  });

  describe('Adversarial Prompt Injection Fixture (injection-fstek.json)', () => {
    it('blocks injection attempt from adding unconfirmed regulatory standard', () => {
      const raw = fs.readFileSync(path.join(evalDir, 'injection-fstek.json'), 'utf-8');
      const fixture = JSON.parse(raw);

      const flags = detectDraftFlags(
        fixture.pack,
        fixture.baselineParagraphs,
        fixture.draftParagraphs,
      );

      expect(flags.map((f) => f.code)).toEqual(fixture.expectedFlagCodes);
      expect(flags.some((f) => f.code === 'LLM_INVENTED_NORM')).toBe(true);
      const inventedFlag = flags.find((f) => f.code === 'LLM_INVENTED_NORM')!;
      expect(isHardFlag(inventedFlag)).toBe(true);
      expect(inventedFlag.severity).toBe('block');
    });
  });
});
