export * from './types';
export * from './profiles';

import type { GostDocumentType } from '../types';
import type { DocumentProfile, StandardProfile } from './types';
import { GOST34_2020_PROFILE, GOST34_LEGACY_PROFILE, GOST34_PROFILES } from './profiles';

export const LEGACY_GOST34_PROFILE_ID = GOST34_LEGACY_PROFILE.id;
export const CURRENT_GOST34_PROFILE_ID = GOST34_2020_PROFILE.id;

/** Compatibility fallback for hand-built/profile-less ASTs and previously issued documents. */
export const DEFAULT_GOST34_PROFILE = GOST34_LEGACY_PROFILE;

/** Default profile for newly normalized/generated documents. */
export const DEFAULT_NEW_GOST34_PROFILE = GOST34_2020_PROFILE;

export function getGost34Profile(id: string) {
  return GOST34_PROFILES.find((profile) => profile.id === id);
}

/**
 * Resolves an explicitly requested profile. New exports without an explicit
 * profile use the current stable profile, while the exporter may still use
 * DEFAULT_GOST34_PROFILE as a compatibility fallback for profile-less ASTs.
 */
export function resolveGost34Profile(id?: string | null): StandardProfile {
  if (!id) return DEFAULT_NEW_GOST34_PROFILE;
  return getGost34Profile(id) || DEFAULT_NEW_GOST34_PROFILE;
}

export function getDocumentProfile(profile: StandardProfile, docType: GostDocumentType): DocumentProfile {
  return (
    profile.documentTypes.find((d) => d.docType === docType) ||
    profile.documentTypes.find((d) => d.docType === 'TZ') ||
    profile.documentTypes[0]
  );
}

export function getDocumentHeadings(
  profile: StandardProfile,
  docType: GostDocumentType
): { title: string; subtitle: string } {
  const doc = getDocumentProfile(profile, docType);
  return { title: doc.title, subtitle: `(${doc.standardCitation})` };
}

export function getZipEntries(profile: StandardProfile): Array<{ docType: GostDocumentType; filename: string }> {
  return [...profile.documentTypes]
    .sort((a, b) => a.zipOrder - b.zipOrder)
    .map((doc) => ({
      docType: doc.docType,
      filename: `${String(doc.zipOrder).padStart(2, '0')}_${doc.docType}_${doc.filenameBase}.docx`,
    }));
}
