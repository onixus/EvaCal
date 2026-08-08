import { analyzeAndNormalizeInput } from './analyzer';
import { buildGost34DocumentAST } from './generator';
import { exportGost34ToDocx } from './exporters/docxExporter';
import { Gost34DocMetadata, Gost34RequirementItem, Gost34DocumentAST } from './types';

export * from './types';
export * from './standards';
export { getEnrichedGostRequirements } from './enricher';
export { analyzeAndNormalizeInput } from './analyzer';
export { buildGost34DocumentAST } from './generator';
export { exportGost34ToDocx } from './exporters/docxExporter';

/**
 * High-level API to generate a GOST 34 document (.docx)
 * directly from an EvaCal Calculation or raw payload inputs.
 */
export async function generateGost34Document(params: {
  calculation?: any;
  metadataOverride?: Partial<Gost34DocMetadata>;
  rawRequirements?: Gost34RequirementItem[];
}): Promise<{ buffer: Buffer; filename: string; ast: Gost34DocumentAST }> {
  const normalizedPayload = analyzeAndNormalizeInput(params);
  const ast = buildGost34DocumentAST(normalizedPayload);
  const buffer = await exportGost34ToDocx(ast);

  const docType = normalizedPayload.metadata.docType || 'TZ';
  const safeName = (normalizedPayload.systemName || 'gost34_doc')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .substring(0, 30);
  const filename = `${docType}_GOST34_${safeName}.docx`;

  return {
    buffer,
    filename,
    ast,
  };
}
