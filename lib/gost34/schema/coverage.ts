import type { Gost34Section } from '../types';
import type { DocumentSchema, SchemaNode, SchemaValidationIssue } from './types';

/** Validate the final tree, including nested order and content after editing. */
export function validateSchemaCoverage(
  schema: DocumentSchema,
  sections: Gost34Section[],
): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];

  const hasContent = (section: Gost34Section): boolean =>
    section.paragraphs.some((text) => text.trim().length > 0) ||
    (section.tables || []).some((table) =>
      [...table.headers, ...table.rows.flat()].some((cell) => String(cell).trim().length > 0),
    ) ||
    (section.subsections || []).some(hasContent);

  function visit(nodes: SchemaNode[], rendered: Gost34Section[]) {
    let lastIndex = -1;
    for (const node of nodes) {
      const index = rendered.findIndex((section) => section.id === node.id);
      if (index === -1) {
        if (node.required) {
          issues.push({
            nodeId: node.id,
            title: node.title,
            kind: 'missing',
            message: `В документе отсутствует обязательный раздел «${node.title}».`,
          });
        }
        continue;
      }
      if (index < lastIndex) {
        issues.push({
          nodeId: node.id,
          title: node.title,
          kind: 'out-of-order',
          message: `Раздел «${node.title}» расположен с нарушением порядка, установленного профилем ${schema.profileId}.`,
        });
      }
      lastIndex = Math.max(lastIndex, index);
      const section = rendered[index];
      if (node.required && (!section.title.trim() || !hasContent(section))) {
        issues.push({
          nodeId: node.id,
          title: node.title,
          kind: 'empty',
          message: `Обязательный раздел «${node.title}» не содержит данных.`,
        });
      }
      visit(node.children || [], section.subsections || []);
    }
  }

  visit(schema.nodes, sections);
  return issues;
}
