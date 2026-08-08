import { describe, it, expect } from 'vitest';
import {
  CURRENT_GOST34_PROFILE_ID,
  DEFAULT_GOST34_PROFILE,
  GOST34_PROFILES,
  LEGACY_GOST34_PROFILE_ID,
  getDocumentProfile,
  getGost34Profile,
  resolveGost34Profile,
} from '../index';
import { GostDocumentType } from '../../types';

const ALL_DOC_TYPES: GostDocumentType[] = ['TZ', 'PZ', 'AF', 'PMI', 'SPEC'];

describe('resolveGost34Profile', () => {
  it('resolves a known id', () => {
    expect(resolveGost34Profile(CURRENT_GOST34_PROFILE_ID).id).toBe(CURRENT_GOST34_PROFILE_ID);
    expect(resolveGost34Profile(LEGACY_GOST34_PROFILE_ID).id).toBe(LEGACY_GOST34_PROFILE_ID);
  });

  it('falls back to legacy for unknown, empty and missing ids', () => {
    expect(resolveGost34Profile('nope').id).toBe(LEGACY_GOST34_PROFILE_ID);
    expect(resolveGost34Profile('').id).toBe(LEGACY_GOST34_PROFILE_ID);
    expect(resolveGost34Profile(undefined).id).toBe(LEGACY_GOST34_PROFILE_ID);
    expect(resolveGost34Profile(null).id).toBe(LEGACY_GOST34_PROFILE_ID);
  });

  it('defaults to the legacy profile so existing exports are unchanged', () => {
    expect(DEFAULT_GOST34_PROFILE.id).toBe('gost34-legacy-89');
  });

  it('getGost34Profile returns undefined for an unknown id', () => {
    expect(getGost34Profile('nope')).toBeUndefined();
  });
});

describe('profile completeness', () => {
  it('has unique profile ids', () => {
    const ids = GOST34_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(GOST34_PROFILES.map((p) => [p.id, p] as const))('%s covers all 5 document types once', (_id, profile) => {
    const docTypes = profile.documentTypes.map((d) => d.docType);
    expect(docTypes.slice().sort()).toEqual(ALL_DOC_TYPES.slice().sort());
    expect(new Set(docTypes).size).toBe(ALL_DOC_TYPES.length);
  });

  it.each(GOST34_PROFILES.map((p) => [p.id, p] as const))('%s has usable document metadata', (_id, profile) => {
    const zipOrders = profile.documentTypes.map((d) => d.zipOrder);
    expect(zipOrders.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(profile.documentTypes.map((d) => d.id)).size).toBe(5);

    for (const doc of profile.documentTypes) {
      expect(doc.title.trim()).not.toBe('');
      expect(doc.standardCitation.trim()).not.toBe('');
      expect(doc.shortLabel.trim()).not.toBe('');
      expect(doc.uiDescription.trim()).not.toBe('');
      // filenameBase goes straight into a ZIP entry name
      expect(doc.filenameBase).not.toMatch(/[\s/\\]/);
      expect(doc.filenameBase).not.toMatch(/\.docx$/);
    }
  });

  it.each(GOST34_PROFILES.map((p) => [p.id, p] as const))('%s has every citation token filled', (_id, profile) => {
    for (const [key, value] of Object.entries(profile.citations)) {
      expect(value.trim(), `citation ${key}`).not.toBe('');
    }
  });
});

describe('getDocumentProfile', () => {
  it('falls back to the TZ entry for an unmapped doc type', () => {
    const profile = resolveGost34Profile(LEGACY_GOST34_PROFILE_ID);
    const stripped = { ...profile, documentTypes: profile.documentTypes.filter((d) => d.docType !== 'SPEC') };
    expect(getDocumentProfile(stripped, 'SPEC').docType).toBe('TZ');
  });
});
