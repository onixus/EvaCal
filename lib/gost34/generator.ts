import { specificationBlockers } from '../specification/validation';
import { UnsupportedGostDocumentTypeError } from './generation/errors';
import { Gost34InputPayload, Gost34DocumentAST, Gost34Section } from './types';
import { ContextGap } from './context/types';
import { SchemaValidationIssue } from './schema/types';
import { buildTZ34Document } from './templates/tz34';
import { buildPZ34Document } from './templates/pz34';
import { buildAF34Sections } from './templates/af34';
import { buildPMI34Sections } from './templates/pmi34';
import { buildSPEC34Sections } from './templates/spec34';
import { buildRP34Sections } from './templates/rp34';
import { buildRA34Sections } from './templates/ra34';
import { buildPSI34Document } from './templates/psi34';
import { buildACT34Document } from './templates/akt34';

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
  PZ: buildPZ34Document,
  AF: (payload) => ({ sections: buildAF34Sections(payload) }),
  PMI: (payload) => ({ sections: buildPMI34Sections(payload) }),
  SPEC: (payload) => ({
    sections: buildSPEC34Sections(payload),
    issues: specificationBlockers(payload.specification).map((message) => ({
      nodeId: 'specification',
      title: 'Состав поставки',
      kind: 'empty' as const,
      message,
    })),
  }),
  RP: (payload) => ({ sections: buildRP34Sections(payload) }),
  RA: (payload) => ({ sections: buildRA34Sections(payload) }),
  // ПСИ и акт печатают факты испытаний; их отсутствие — пробел, не блокер.
  PSI: buildPSI34Document,
  ACT: buildACT34Document,
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

  if (!Object.prototype.hasOwnProperty.call(BUILDERS, docType)) {
    throw new UnsupportedGostDocumentTypeError(docType);
  }
  const builder = BUILDERS[docType];
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
