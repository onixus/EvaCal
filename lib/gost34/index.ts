import { analyzeAndNormalizeInput } from './analyzer';
import { buildGost34DocumentAST, Gost34BuildDiagnostics } from './generator';
import { exportGost34ToDocx } from './exporters/docxExporter';
import { Gost34DocMetadata, Gost34RequirementItem, Gost34DocumentAST } from './types';
import { ProjectContext } from './context/types';

export * from './types';
export * from './standards';
export * from './context';
export * from './validation';
export * from './applicability';
export * from './traceability';
export { getEnrichedGostRequirements } from './enricher';
export { analyzeAndNormalizeInput } from './analyzer';
export { buildGost34DocumentAST } from './generator';
export type { Gost34BuildDiagnostics } from './generator';
export { exportGost34ToDocx } from './exporters/docxExporter';
export { buildTZ34Document } from './templates/tz34';
export { TZ_SCHEMA_2020 } from './schema/tz34-2020';
export { renderDocumentSchema, validateSchemaCoverage } from './schema/renderer';
export type { DocumentSchema, SchemaNode, SchemaValidationIssue } from './schema/types';

export async function generateGost34Document(params: {
  calculation?: any;
  metadataOverride?: Partial<Gost34DocMetadata>;
  rawRequirements?: Gost34RequirementItem[];
  projectContext?: Partial<ProjectContext>;
}): Promise<{
  buffer: Buffer;
  filename: string;
  ast: Gost34DocumentAST;
  diagnostics: Gost34BuildDiagnostics;
}> {
  const normalizedPayload = analyzeAndNormalizeInput(params);
  const ast = buildGost34DocumentAST(normalizedPayload);
  const buffer = await exportGost34ToDocx(ast);

  const docType = normalizedPayload.metadata.docType || 'TZ';
  const safeName = (normalizedPayload.systemName || 'gost34_doc')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .substring(0, 30);
  const filename = `${docType}_GOST34_${safeName}.docx`;

  return { buffer, filename, ast, diagnostics: ast.diagnostics };
}
