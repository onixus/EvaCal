import { exportGost34ToDocx } from '../exporters/docxExporter';
import { prepareGost34Document } from './prepareDocument';
import type { Gost34GenerationParams } from './prepareDocument';

export async function generateGost34Document(params: Gost34GenerationParams) {
  const { ast, diagnostics } = prepareGost34Document(params);
  const buffer = await exportGost34ToDocx(ast);
  const safeName = (ast.metadata.systemName || 'gost34_doc')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .substring(0, 30);
  const filename = `${ast.metadata.docType || 'TZ'}_GOST34_${safeName}.docx`;
  return { buffer, filename, ast, diagnostics };
}
