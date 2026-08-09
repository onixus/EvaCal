import { Gost34InputPayload, Gost34DocumentAST, Gost34Section } from './types';
import { ContextGap } from './context/types';
import { SchemaValidationIssue } from './schema/types';
import { buildTZ34Document } from './templates/tz34';
import { buildPZ34Sections } from './templates/pz34';
import { buildAF34Sections } from './templates/af34';
import { buildPMI34Sections } from './templates/pmi34';
import { buildSPEC34Sections } from './templates/spec34';

export interface Gost34BuildDiagnostics {
  /** Сведения проектного контекста, требующие уточнения. */
  gaps: ContextGap[];
  /** Нарушения структуры документа относительно нормативного профиля. */
  issues: SchemaValidationIssue[];
}

/**
 * Builds the complete document AST according to GOST 34 / RD 50-34.698-90
 */
export function buildGost34DocumentAST(
  payload: Gost34InputPayload,
): Gost34DocumentAST & { diagnostics: Gost34BuildDiagnostics } {
  const meta = payload.metadata;
  const docType = meta.docType || 'TZ';

  let sections: Gost34Section[];
  const diagnostics: Gost34BuildDiagnostics = { gaps: [], issues: [] };

  switch (docType) {
    case 'PZ':
      sections = buildPZ34Sections(payload);
      break;
    case 'AF':
      sections = buildAF34Sections(payload);
      break;
    case 'PMI':
      sections = buildPMI34Sections(payload);
      break;
    case 'SPEC':
      sections = buildSPEC34Sections(payload);
      break;
    case 'TZ':
    default: {
      const tz = buildTZ34Document(payload);
      sections = tz.sections;
      diagnostics.gaps = tz.gaps;
      diagnostics.issues = tz.issues;
      break;
    }
  }

  return {
    metadata: meta,
    sections,
    standardProfile: payload.standardProfile,
    diagnostics,
  };
}
