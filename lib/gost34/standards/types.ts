import type { GostDocumentType } from '../types';

export interface StandardReference {
  id: string;
  title: string;
  version: string;
  role: string;
}

/**
 * Per-document-type facts owned by a standard profile: everything that used to
 * be hardcoded in the exporter title switch, the ZIP filename list and the UI
 * document-type grid.
 */
export interface DocumentProfile {
  id: string;
  docType: GostDocumentType;
  /** Document title, uppercase, as printed on the title page. */
  title: string;
  /** Standard citation printed under the title, WITHOUT the surrounding parentheses. */
  standardCitation: string;
  /** Short label for UI ("ТЗ", "ПЗ", …). */
  shortLabel: string;
  /** One-line description for the UI document-type grid. */
  uiDescription: string;
  /** Filename body used in the batch ZIP (no extension, no separators). */
  filenameBase: string;
  /** Position in the batch ZIP, 1-based; renders as the "01_TZ" prefix. */
  zipOrder: number;
  /** Mandatory section structure. Owned by PR-03 (schema-driven TZ) — left empty for now. */
  sections: string[];
}

/**
 * Citation tokens referenced from inside document templates. Keys are semantic
 * (what the citation is for), never the standard number itself.
 */
export type CitationKey =
  | 'primary'
  | 'documentsClassifier'
  | 'projectDocumentation'
  | 'testing'
  /** Standards the equipment/software specification is drawn up under, incl. clause. */
  | 'specificationBasis'
  | 'referencesList'
  | 'frameFallbackTitle'
  | 'documentationSetSentence';

export interface StandardProfile {
  id: string;
  name: string;
  version: string;
  effectiveFrom: string;
  /**
   * `preview` means the profile's citations are current but the document
   * structure has not been migrated yet — it must not be offered in the UI.
   */
  status: 'stable' | 'preview';
  primaryStandard: StandardReference;
  documentStandards: StandardReference[];
  lifecycleStandards: StandardReference[];
  testingStandards: StandardReference[];
  documentTypes: DocumentProfile[];
  citations: Record<CitationKey, string>;
}
