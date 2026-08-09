/**
 * Рендерер схемы документа: дерево SchemaNode → Gost34Section[].
 *
 * Нумерация разделов, подразделов и пунктов вычисляется здесь и нигде
 * больше — в build-функциях номера не пишутся руками.
 */

import { Gost34Section } from '../types';
import { CONTEXT_GAP_PLACEHOLDER, ContextGap } from '../context/types';
import {
  DocumentBuildContext,
  DocumentSchema,
  SchemaNode,
  SchemaValidationIssue,
  SectionContent,
} from './types';

const APPENDIX_LETTERS = [
  'А',
  'Б',
  'В',
  'Г',
  'Д',
  'Е',
  'Ж',
  'И',
  'К',
  'Л',
  'М',
  'Н',
  'П',
  'Р',
  'С',
  'Т',
];

export interface RenderResult {
  sections: Gost34Section[];
  /** Все пробелы контекста, попавшие в документ, в порядке разделов. */
  gaps: ContextGap[];
  issues: SchemaValidationIssue[];
}

export function renderDocumentSchema(
  schema: DocumentSchema,
  ctx: DocumentBuildContext,
): RenderResult {
  const gaps: ContextGap[] = [];
  const issues: SchemaValidationIssue[] = [];

  const bodyNodes = schema.nodes.filter((n) => !n.appendix);
  const appendixNodes = schema.nodes.filter((n) => n.appendix);

  const sections: Gost34Section[] = [];
  let sectionNumber = 0;
  let appendixIndex = 0;

  for (const node of bodyNodes) {
    if (node.includeWhen && !node.includeWhen(ctx)) {
      if (node.required) {
        issues.push({
          nodeId: node.id,
          title: node.title,
          kind: 'missing',
          message: `Обязательный раздел «${node.title}» исключён из документа.`,
        });
      }
      continue;
    }
    sectionNumber += 1;
    sections.push(renderNode(node, String(sectionNumber), ctx, gaps, issues));
  }

  for (const node of appendixNodes) {
    if (node.includeWhen && !node.includeWhen(ctx)) continue;
    const letter = APPENDIX_LETTERS[appendixIndex] ?? String(appendixIndex + 1);
    appendixIndex += 1;
    const section = renderNode(node, `Приложение ${letter}`, ctx, gaps, issues);
    sections.push(section);
  }

  return { sections, gaps, issues };
}

function renderNode(
  node: SchemaNode,
  numStr: string,
  ctx: DocumentBuildContext,
  gaps: ContextGap[],
  issues: SchemaValidationIssue[],
): Gost34Section {
  const content: SectionContent = node.build ? node.build(ctx) : {};
  const paragraphs: string[] = [...(content.paragraphs || [])];

  (content.items || []).forEach((item, idx) => {
    paragraphs.push(`${numStr}.${idx + 1} ${item}`);
  });

  if (content.gaps && content.gaps.length > 0) {
    gaps.push(...content.gaps);
    for (const g of content.gaps) {
      paragraphs.push(
        `${g.label} — ${CONTEXT_GAP_PLACEHOLDER}${g.hint ? ` (источник данных: ${g.hint})` : ''}.`,
      );
    }
  }

  const subsections: Gost34Section[] = [];
  let childNumber = 0;
  for (const child of node.children || []) {
    if (child.includeWhen && !child.includeWhen(ctx)) {
      if (child.required) {
        issues.push({
          nodeId: child.id,
          title: child.title,
          kind: 'missing',
          message: `Обязательный подраздел «${child.title}» исключён из документа.`,
        });
      }
      continue;
    }
    childNumber += 1;
    subsections.push(renderNode(child, `${numStr}.${childNumber}`, ctx, gaps, issues));
  }

  const hasContent =
    paragraphs.length > 0 || (content.tables || []).length > 0 || subsections.length > 0;
  if (node.required && !hasContent) {
    issues.push({
      nodeId: node.id,
      title: node.title,
      kind: 'empty',
      message: `Обязательный раздел «${node.title}» не содержит данных.`,
    });
  }

  return {
    id: node.id,
    numStr,
    title: node.title,
    paragraphs,
    tables: content.tables,
    subsections: subsections.length > 0 ? subsections : undefined,
  };
}

/**
 * Проверяет, что построенный документ содержит все обязательные разделы
 * схемы в объявленном порядке.
 */
export function validateSchemaCoverage(
  schema: DocumentSchema,
  sections: Gost34Section[],
): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  const renderedIds = sections.map((s) => s.id);

  let lastIndex = -1;
  for (const node of schema.nodes) {
    const index = renderedIds.indexOf(node.id);
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
    lastIndex = index;

    const rendered = sections[index];
    for (const child of node.children || []) {
      const childRendered = (rendered.subsections || []).some((s) => s.id === child.id);
      if (!childRendered && child.required) {
        issues.push({
          nodeId: child.id,
          title: child.title,
          kind: 'missing',
          message: `В разделе «${node.title}» отсутствует обязательный подраздел «${child.title}».`,
        });
      }
    }
  }

  return issues;
}
