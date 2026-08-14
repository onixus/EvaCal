import { analyzeAndNormalizeInput } from './analyzer';
import { buildGost34DocumentAST, Gost34BuildDiagnostics } from './generator';
import { exportGost34ToDocx } from './exporters/docxExporter';
import {
  Gost34DocMetadata,
  Gost34RequirementItem,
  Gost34DocumentAST,
  Gost34Section,
} from './types';
import { ProjectContext } from './context/types';
import type { TraceLink } from './traceability/types';

export * from './types';
export * from './standards';
export * from './context';
export * from './validation';
export * from './applicability';
export * from './traceability';
export * from './wizard';
export * from './migration';
export { getEnrichedGostRequirements } from './enricher';
export { analyzeAndNormalizeInput } from './analyzer';
export { buildGost34DocumentAST } from './generator';
export type { Gost34BuildDiagnostics } from './generator';
export { exportGost34ToDocx } from './exporters/docxExporter';
export {
  LAYOUT_PROFILES,
  DEFAULT_LAYOUT_PROFILE,
  getLayoutProfile,
  resolveLayoutProfileId,
} from './exporters/layout';
export type { LayoutProfile, LayoutProfileId } from './exporters/layout';
export { buildTZ34Document } from './templates/tz34';
export { TZ_SCHEMA_2020 } from './schema/tz34-2020';
export { renderDocumentSchema, validateSchemaCoverage } from './schema/renderer';
export type { DocumentSchema, SchemaNode, SchemaValidationIssue } from './schema/types';

function applySectionOverrides(
  sections: Gost34Section[],
  overrides: Record<string, { title?: string; paragraphs?: string[] }>,
): Gost34Section[] {
  return sections.map((sec) => {
    const override = overrides[sec.title];
    return {
      ...sec,
      title: override?.title ?? sec.title,
      paragraphs: override?.paragraphs ?? sec.paragraphs,
      subsections: sec.subsections ? applySectionOverrides(sec.subsections, overrides) : undefined,
    };
  });
}

export async function generateGost34Document(params: {
  calculation?: import('./types').Gost34CalculationInput;
  metadataOverride?: Partial<Gost34DocMetadata>;
  rawRequirements?: Gost34RequirementItem[];
  projectContext?: Partial<ProjectContext>;
  /** Подтверждённые в мастере связи «требование → этап» (PR-10). */
  manualTraceLinks?: TraceLink[];
  /** Ручные правки разделов ТЗ из интерактивного редактора предпросмотра. */
  sectionOverrides?: Record<string, { title?: string; paragraphs?: string[] }>;
}): Promise<{
  buffer: Buffer;
  filename: string;
  ast: Gost34DocumentAST;
  diagnostics: Gost34BuildDiagnostics;
}> {
  const normalizedPayload = analyzeAndNormalizeInput(params);
  const ast = buildGost34DocumentAST(normalizedPayload);

  if (params.sectionOverrides && Object.keys(params.sectionOverrides).length > 0) {
    ast.sections = applySectionOverrides(ast.sections, params.sectionOverrides);
  }

  const buffer = await exportGost34ToDocx(ast);

  const docType = normalizedPayload.metadata.docType || 'TZ';
  const safeName = (normalizedPayload.systemName || 'gost34_doc')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .substring(0, 30);
  const filename = `${docType}_GOST34_${safeName}.docx`;

  return { buffer, filename, ast, diagnostics: ast.diagnostics };
}
