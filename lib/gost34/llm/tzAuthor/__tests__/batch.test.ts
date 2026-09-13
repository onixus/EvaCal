import { describe, it, expect } from 'vitest';
import { TZ_SCHEMA_2020 } from '../../../schema/tz34-2020';
import { walkDraftableNodes, LEAD_IN_ONLY_NODE_IDS } from '../schemaWalk';
import type { TzAuthorState, TzSectionProposal } from '../types';

describe('TZ Author batch drafting utilities (PR-08)', () => {
  it('walkDraftableNodes traverses all draftable nodes in TZ_SCHEMA_2020 safely without context', () => {
    const nodes = walkDraftableNodes(TZ_SCHEMA_2020);
    expect(nodes.length).toBeGreaterThan(10);

    // Grouping containers should NOT be draftable
    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds).not.toContain('tz2020-goals');
    expect(nodeIds).not.toContain('tz2020-requirements');

    // Children and leaf nodes SHOULD be draftable
    expect(nodeIds).toContain('tz2020-general');
    expect(nodeIds).toContain('tz2020-goals-goals');
    expect(nodeIds).toContain('tz2020-goals-purpose');
    expect(nodeIds).toContain('tz2020-req-common-tech');
    expect(nodeIds).toContain('tz2020-work-scope');
    expect(nodeIds).toContain('tz2020-development-order');

    // All nodes should have id, title, and numStr
    for (const n of nodes) {
      expect(n.id).toBeTruthy();
      expect(n.title).toBeTruthy();
      expect(n.numStr).toBeTruthy();
    }
  });

  it('correctly marks lead-in only nodes', () => {
    const nodes = walkDraftableNodes(TZ_SCHEMA_2020);
    for (const n of nodes) {
      if (LEAD_IN_ONLY_NODE_IDS.has(n.id)) {
        expect(n.leadInOnly).toBe(true);
      } else {
        expect(n.leadInOnly).toBe(false);
      }
    }
  });

  it('filters onlyUnproposed nodes accurately based on existing proposal status', () => {
    const nodes = walkDraftableNodes(TZ_SCHEMA_2020).map((n) => ({
      id: n.id,
      title: n.title,
    }));

    const mockState: TzAuthorState = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          status: 'ACCEPTED',
          paragraphs: ['Принятый текст'],
          flags: [],
          usedLlm: true,
          speculate: false,
          generatedAt: new Date().toISOString(),
        } as TzSectionProposal,
        'tz2020-goals-goals': {
          nodeId: 'tz2020-goals-goals',
          status: 'PROPOSED',
          paragraphs: ['Черновой текст'],
          flags: [],
          usedLlm: true,
          speculate: false,
          generatedAt: new Date().toISOString(),
        } as TzSectionProposal,
        'tz2020-goals-purpose': {
          nodeId: 'tz2020-goals-purpose',
          status: 'REJECTED',
          paragraphs: [],
          flags: [],
          usedLlm: false,
          speculate: false,
          generatedAt: new Date().toISOString(),
        } as TzSectionProposal,
      },
    };

    // Filter only unproposed / rejected
    const unproposed = nodes.filter(
      (n) =>
        !mockState.proposals[n.id] ||
        mockState.proposals[n.id].status === 'REJECTED',
    );

    const unproposedIds = unproposed.map((u) => u.id);
    // ACCEPTED and PROPOSED must be excluded
    expect(unproposedIds).not.toContain('tz2020-general');
    expect(unproposedIds).not.toContain('tz2020-goals-goals');

    // REJECTED and non-existent must be included
    expect(unproposedIds).toContain('tz2020-goals-purpose');
    expect(unproposedIds).toContain('tz2020-req-common-tech');
  });
});
