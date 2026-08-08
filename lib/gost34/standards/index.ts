export * from './types';
export * from './profiles';

import type { GostDocumentType } from '../types';
import type { DocumentProfile, StandardProfile } from './types';
import { GOST34_2020_PROFILE, GOST34_LEGACY_PROFILE, GOST34_PROFILES } from './profiles';

export const LEGACY_GOST34_PROFILE_ID = GOST34_LEGACY_PROFILE.id;
export const CURRENT_GOST34_PROFILE_ID = GOST34_2020_PROFILE.id;

/**
 * Default profile is the legacy one: it reproduces the output every existing
 * project already has. The current profile becomes the default for new projects
 * once the 2020 TZ structure lands (PR-03/PR-04).
 */
export const DEFAULT_GOST34_PROFILE = GOST34_LEGACY_PROFILE;

export function getGost34Profile(id: string) {
  return GOST34_PROFILES.find((profile) => profile.id === id);
}

/**
 * Never throws: an unknown or missing profile id falls back to legacy so that a
 * malformed query parameter cannot turn a document export into a 500.
 */
export function resolveGost34Profile(id?: string | null): StandardProfile {
  if (!id) return DEFAULT_GOST34_PROFILE;
  return getGost34Profile(id) || DEFAULT_GOST34_PROFILE;
}

/** Falls back to the TZ entry, mirroring the exporter's former `default:` branch. */
export function getDocumentProfile(profile: StandardProfile, docType: GostDocumentType): DocumentProfile {
  return (
    profile.documentTypes.find((d) => d.docType === docType) ||
    profile.documentTypes.find((d) => d.docType === 'TZ') ||
    profile.documentTypes[0]
  );
}

/** Title page heading pair. Replaces the docType switch in docxExporter. */
export function getDocumentHeadings(
  profile: StandardProfile,
  docType: GostDocumentType
): { title: string; subtitle: string } {
  const doc = getDocumentProfile(profile, docType);
  return { title: doc.title, subtitle: `(${doc.standardCitation})` };
}

/** Ordered batch-ZIP entries. Replaces the hardcoded list in the export route. */
export function getZipEntries(profile: StandardProfile): Array<{ docType: GostDocumentType; filename: string }> {
  return [...profile.documentTypes]
    .sort((a, b) => a.zipOrder - b.zipOrder)
    .map((doc) => ({
      docType: doc.docType,
      filename: `${String(doc.zipOrder).padStart(2, '0')}_${doc.docType}_${doc.filenameBase}.docx`,
    }));
}
