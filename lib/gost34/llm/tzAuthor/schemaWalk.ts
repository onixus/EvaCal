import { DocumentSchema, DocumentBuildContext, SchemaNode } from '../../schema/types';
import { ProjectContext } from '../../context/types';

export interface DraftableNodeInfo {
  id: string;
  title: string;
  numStr: string;
  required: boolean;
  hasChildren: boolean;
  leadInOnly: boolean;
  node: SchemaNode;
}

export const LEAD_IN_ONLY_NODE_IDS = new Set([
  'tz2020-req-functions',
  'tz2020-work-scope',
  'tz2020-acceptance',
  'tz2020-appendix-gaps',
]);

const APPENDIX_LETTERS = [
  'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'И', 'К', 'Л', 'М', 'Н', 'П', 'Р', 'С', 'Т',
];

export function walkDraftableNodes(
  schema: DocumentSchema,
  ctx?: Partial<DocumentBuildContext> | { context?: Partial<ProjectContext>; [key: string]: any },
): DraftableNodeInfo[] {
  const result: DraftableNodeInfo[] = [];
  const buildCtx = {
    context: {},
    requirements: [],
    payload: { metadata: {} },
    ...(ctx || {}),
  } as unknown as DocumentBuildContext;

  const bodyNodes = schema.nodes.filter((n) => !n.appendix);
  const appendixNodes = schema.nodes.filter((n) => n.appendix);

  let sectionNumber = 0;
  let appendixIndex = 0;

  function walk(node: SchemaNode, numStr: string) {
    if (node.includeWhen && !node.includeWhen(buildCtx)) {
      return;
    }

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isDraftable = typeof node.build === 'function';

    if (isDraftable) {
      result.push({
        id: node.id,
        title: node.title,
        numStr,
        required: Boolean(node.required),
        hasChildren,
        leadInOnly: LEAD_IN_ONLY_NODE_IDS.has(node.id),
        node,
      });
    }

    if (hasChildren) {
      let childNumber = 0;
      for (const child of node.children!) {
        if (child.includeWhen && !child.includeWhen(buildCtx)) {
          continue;
        }
        childNumber += 1;
        walk(child, `${numStr}.${childNumber}`);
      }
    }
  }

  for (const node of bodyNodes) {
    if (node.includeWhen && !node.includeWhen(buildCtx)) {
      continue;
    }
    sectionNumber += 1;
    walk(node, String(sectionNumber));
  }

  for (const node of appendixNodes) {
    if (node.includeWhen && !node.includeWhen(buildCtx)) {
      continue;
    }
    const letter = APPENDIX_LETTERS[appendixIndex] ?? String(appendixIndex + 1);
    appendixIndex += 1;
    walk(node, `Приложение ${letter}`);
  }

  return result;
}
