import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { walkDraftableNodes, LEAD_IN_ONLY_NODE_IDS } from '../schemaWalk';
import {
  collectGroundingPack,
  collectAllowedCitations,
  hasNonGapFacts,
  shouldSkipLlm,
} from '../grounding';
import { TZ_SCHEMA_2020 } from '../../../schema/tz34-2020';
import { ProjectContext } from '../../../context/types';
import { Gost34InputPayload } from '../../../types';
import { GOST34_2020_PROFILE } from '../../../standards/profiles';
import { Gost34RequirementV2 } from '../../../requirements/v2';

function createMockPayload(overrides: Partial<Gost34InputPayload> = {}): Gost34InputPayload {
  const profile = GOST34_2020_PROFILE;
  return {
    metadata: {
      docType: 'TZ',
      systemName: 'АС Тест',
      fullSystemName: 'Автоматизированная система Тест',
      documentCode: 'АБВГ.123456.001 ТЗ',
      customerName: 'Заказчик',
      developerName: 'Разработчик',
      signatures: { developer: 'Иванов', checker: 'Петров', techControl: 'Сидоров', normControl: 'Кузнецов', approver: 'Васильев' },
      city: 'Москва',
      year: 2026,
      version: '1.0',
    },
    standardProfile: profile,
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

describe('PR-03: schemaWalk & grounding', () => {
  describe('walkDraftableNodes', () => {
    it('returns exactly 14 nodes when there are no gaps', () => {
      const payload = createMockPayload();
      const context = createMockContext({ gaps: [] });
      const nodes = walkDraftableNodes(TZ_SCHEMA_2020, { payload, context, schema: TZ_SCHEMA_2020 });
      expect(nodes.length).toBe(14);
      expect(nodes.find((n) => n.id === 'tz2020-appendix-gaps')).toBeUndefined();
    });

    it('returns exactly 15 nodes when gaps are present (includes appendix-gaps)', () => {
      const payload = createMockPayload();
      const context = createMockContext({
        gaps: [{ path: 'availability.rto', label: 'RTO', severity: 'major' }],
      });
      const nodes = walkDraftableNodes(TZ_SCHEMA_2020, { payload, context, schema: TZ_SCHEMA_2020 });
      expect(nodes.length).toBe(15);
      const gapsNode = nodes.find((n) => n.id === 'tz2020-appendix-gaps');
      expect(gapsNode).toBeDefined();
      expect(gapsNode?.numStr).toBe('Приложение А');
      expect(gapsNode?.leadInOnly).toBe(true);
    });

    it('sets leadInOnly correctly according to spec', () => {
      const payload = createMockPayload();
      const context = createMockContext({ gaps: [{ path: 'g1', label: 'gap', severity: 'minor' }] });
      const nodes = walkDraftableNodes(TZ_SCHEMA_2020, { payload, context, schema: TZ_SCHEMA_2020 });

      for (const node of nodes) {
        if (LEAD_IN_ONLY_NODE_IDS.has(node.id)) {
          expect(node.leadInOnly).toBe(true);
        } else {
          expect(node.leadInOnly).toBe(false);
        }
      }
    });
  });

  describe('collectAllowedCitations', () => {
    it('tz2020-general + fstek_21=UNKNOWN includes primary GOST and excludes FSTEK', () => {
      const payload = createMockPayload();
      const applicability = [
        { standardId: 'fstek_21', title: 'Приказ ФСТЭК России № 21', finalStatus: 'UNKNOWN' as const },
      ];

      const { allowedCitationIds, allowedCitationTexts } = collectAllowedCitations(
        'tz2020-general',
        payload,
        applicability,
      );

      expect(allowedCitationIds).toContain('gost-34.602-2020');
      expect(allowedCitationTexts).toContain('ГОСТ 34.602-2020');
      expect(allowedCitationIds).not.toContain('fstek_21');
      expect(allowedCitationTexts.join(' ')).not.toMatch(/ФСТЭК|№\s*21/i);
    });

    it('does not reference referencesList from citations anywhere in the source', () => {
      const filePath = path.resolve(__dirname, '../grounding.ts');
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      expect(fileContent).not.toContain('referencesList');
    });
  });

  describe('collectGroundingPack requirements sorting and filtering', () => {
    it('sorts requirements for tz2020-req-functions: APPROVED -> functional -> system -> code, max 40', () => {
      const reqs: Gost34RequirementV2[] = [
        {
          id: 'r1',
          code: 'ТР-01',
          title: 'Требование 1',
          category: 'technical',
          type: 'system',
          originalText: 'Desc 1',
          approval: { status: 'PROPOSED' },
        },
        {
          id: 'r2',
          code: 'ТР-02',
          title: 'Требование 2',
          category: 'functional',
          type: 'functional',
          originalText: 'Desc 2',
          approval: { status: 'APPROVED' },
        },
        {
          id: 'r3',
          code: 'ТР-03',
          title: 'Требование 3',
          category: 'functional',
          type: 'system',
          originalText: 'Desc 3',
          approval: { status: 'APPROVED' },
        },
        {
          id: 'r4',
          code: 'ТР-00',
          title: 'Требование 0',
          category: 'functional',
          type: 'system',
          originalText: 'Desc 0',
          approval: { status: 'APPROVED' },
        },
      ];

      const payload = createMockPayload({ requirementsV2: reqs });
      const context = createMockContext();

      const pack = collectGroundingPack({
        nodeId: 'tz2020-req-functions',
        payload,
        context,
      });

      expect(pack.requirements.length).toBe(4);
      // r4 and r3 are both APPROVED, functional, system -> sorted by code: ТР-00 then ТР-03
      expect(pack.requirements[0].code).toBe('ТР-00');
      expect(pack.requirements[1].code).toBe('ТР-03');
      // r2 is APPROVED, functional, but type is functional -> comes after system
      expect(pack.requirements[2].code).toBe('ТР-02');
      // r1 is PROPOSED -> comes last
      expect(pack.requirements[3].code).toBe('ТР-01');
    });
  });

  describe('short-circuiting (shouldSkipLlm)', () => {
    it('shouldSkipLlm returns true when speculate is false and no facts exist', () => {
      const payload = createMockPayload({
        stages: [],
        customRequirements: [],
        requirementsV2: [],
        totalLaborHours: undefined,
      });
      const emptyContext = createMockContext({
        systemPurpose: '',
        goals: [],
        automationObject: '',
        architecture: { components: [] },
        gaps: [{ path: 'availability.rtoMinutes', label: 'RTO', severity: 'major' }],
      });

      const pack = collectGroundingPack({
        nodeId: 'tz2020-req-common-tech',
        payload,
        context: emptyContext,
        speculate: false,
      });

      expect(hasNonGapFacts(pack)).toBe(false);
      expect(shouldSkipLlm(pack)).toBe(true);
    });

    it('shouldSkipLlm returns false when speculate is true even without facts', () => {
      const payload = createMockPayload();
      const emptyContext = createMockContext({
        systemPurpose: '',
        goals: [],
        automationObject: '',
      });

      const pack = collectGroundingPack({
        nodeId: 'tz2020-req-common-tech',
        payload,
        context: emptyContext,
        speculate: true,
      });

      expect(shouldSkipLlm(pack)).toBe(false);
    });
  });
});
