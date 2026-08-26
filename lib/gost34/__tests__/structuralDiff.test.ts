import { describe, it, expect } from 'vitest';
import { computePackageDiff, GostPackageLike } from '../diff';

describe('GOST 34 Structural Diff Engine', () => {
  it('detects added, removed, and modified requirements across two package versions', () => {
    const pkgV1: GostPackageLike = {
      id: 'pkg-1',
      version: 1,
      name: 'Комплект ГОСТ 34 v1',
      status: 'under_review',
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '2020',
      generatorVersion: '0.2.0',
      documentTypes: JSON.stringify(['tz', 'pmi']),
      createdAt: '2026-08-01T10:00:00Z',
      snapshot: JSON.stringify({
        standardProfileId: 'ru-gost34-current',
        layoutProfileId: 'gost34-modern',
        requirements: [
          {
            id: 'REQ-01',
            originalText: 'Резервирование СУБД Active-Passive',
            category: 'high_availability',
            status: 'APPLICABLE',
            source: 'vendor',
          },
          {
            id: 'REQ-02',
            originalText: 'Межсетевой экран UserGate 4 класс',
            category: 'security',
            status: 'APPLICABLE',
            source: 'vendor',
          },
        ],
        manualLinks: [{ sourceId: 'REQ-01', targetStageId: 'STAGE-01' }],
        applicabilityOverrides: {
          '152-fz': { applicable: true },
        },
        sectionOverrides: {},
      }),
    };

    const pkgV2: GostPackageLike = {
      id: 'pkg-2',
      version: 2,
      name: 'Комплект ГОСТ 34 v2',
      status: 'approved',
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '2020',
      generatorVersion: '0.3.0',
      documentTypes: JSON.stringify(['tz', 'pmi', 'spec']),
      createdAt: '2026-08-10T12:00:00Z',
      snapshot: JSON.stringify({
        standardProfileId: 'ru-gost34-current',
        layoutProfileId: 'gost34-eskd-frame',
        requirements: [
          {
            id: 'REQ-01',
            originalText: 'Резервирование СУБД Active-Active (два ЦОД)',
            category: 'high_availability',
            status: 'APPLICABLE',
            source: 'vendor',
          },
          {
            id: 'REQ-03',
            originalText: 'Шифрование каналов ViPNet ГОСТ',
            category: 'security',
            status: 'APPLICABLE',
            source: 'manual',
          },
        ],
        manualLinks: [
          { sourceId: 'REQ-01', targetStageId: 'STAGE-01' },
          { sourceId: 'REQ-03', targetStageId: 'STAGE-02' },
        ],
        applicabilityOverrides: {
          '152-fz': { applicable: true },
          '187-fz': { applicable: true },
        },
        sectionOverrides: {
          'tz.section.4.1': { title: 'Кастомный заголовок подраздела 4.1' },
        },
      }),
    };

    const diff = computePackageDiff(pkgV1, pkgV2);

    expect(diff.fromPackage.version).toBe(1);
    expect(diff.toPackage.version).toBe(2);

    // Document types diff
    expect(diff.general.documentTypesAdded).toEqual(['spec']);
    expect(diff.general.documentTypesRemoved).toEqual([]);

    // Layout diff
    expect(diff.general.layoutChanged).toBe(true);
    expect(diff.general.layoutFrom).toBe('gost34-modern');
    expect(diff.general.layoutTo).toBe('gost34-eskd-frame');

    // Requirements diff
    expect(diff.requirements.added).toHaveLength(1);
    expect(diff.requirements.added[0].id).toBe('REQ-03');

    expect(diff.requirements.removed).toHaveLength(1);
    expect(diff.requirements.removed[0].id).toBe('REQ-02');

    expect(diff.requirements.modified).toHaveLength(1);
    expect(diff.requirements.modified[0].id).toBe('REQ-01');
    expect(diff.requirements.modified[0].changes).toContain('originalText');

    // Traceability links diff
    expect(diff.traceability.addedLinks).toHaveLength(1);
    expect(diff.traceability.addedLinks[0].sourceId).toBe('REQ-03');
    expect(diff.traceability.coverageFrom).toBe(50);
    expect(diff.traceability.coverageTo).toBe(100);

    // Applicability diff
    expect(diff.applicability.changedStandards).toHaveLength(1);
    expect(diff.applicability.changedStandards[0].standardId).toBe('187-fz');

    // Section overrides diff
    expect(diff.sections.overrides).toHaveLength(1);
    expect(diff.sections.overrides[0].sectionKey).toBe('tz.section.4.1');
    expect(diff.sections.overrides[0].type).toBe('added');
  });
});
