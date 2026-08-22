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

type DocumentBuilder = (payload: Gost34InputPayload) => {
  sections: Gost34Section[];
  gaps?: ContextGap[];
  issues?: SchemaValidationIssue[];
};

const BUILDERS: Record<string, DocumentBuilder> = {
  PZ: (payload) => ({ sections: buildPZ34Sections(payload) }),
  AF: (payload) => ({ sections: buildAF34Sections(payload) }),
  PMI: (payload) => ({ sections: buildPMI34Sections(payload) }),
  SPEC: (payload) => ({ sections: buildSPEC34Sections(payload) }),
  TZ: buildTZ34Document,
};

/**
 * Builds the complete document AST according to GOST 34 / RD 50-34.698-90
 */
export function buildGost34DocumentAST(
  payload: Gost34InputPayload,
): Gost34DocumentAST & { diagnostics: Gost34BuildDiagnostics } {
  const meta = payload.metadata;
  const docType = meta.docType || 'TZ';

  const builder = BUILDERS[docType] || BUILDERS['TZ'];
  const result = builder(payload);

  return {
    metadata: meta,
    sections: result.sections,
    standardProfile: payload.standardProfile,
    diagnostics: {
      gaps: result.gaps || [],
      issues: result.issues || [],
    },
  };
}
