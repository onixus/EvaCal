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
  /**
   * Пробелы контекста, попавшие в документ, в порядке первого упоминания.
   * Без повторов: одно поле контекста — одна запись, даже если его касаются
   * несколько разделов.
   */
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

  // Буквы приложений нужны ещё до отрисовки тела: разделы ссылаются на сводный
  // перечень пробелов, а он идёт последним.
  const appendixLetters = new Map<string, string>();
  let plannedAppendix = 0;
  for (const node of appendixNodes) {
    if (node.includeWhen && !node.includeWhen(ctx)) continue;
    appendixLetters.set(node.id, APPENDIX_LETTERS[plannedAppendix] ?? String(plannedAppendix + 1));
    plannedAppendix += 1;
  }
  const registryNode = appendixNodes.find((n) => n.gapRegistry && appendixLetters.has(n.id));
  const gapRegistryRef = registryNode
    ? `приложении ${appendixLetters.get(registryNode.id)}`
    : undefined;

  // Один пробел — одна отметка. Повторное упоминание того же поля в другом
  // разделе даёт ссылку на сводный перечень: раньше «Ролевая модель системы —
  // требует уточнения» печаталось и в 4.1, и в 4.3 одним и тем же абзацем.
  const printedGaps = new Set<string>();

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
    sections.push(
      renderNode(node, String(sectionNumber), ctx, gaps, issues, printedGaps, gapRegistryRef),
    );
  }

  for (const node of appendixNodes) {
    if (node.includeWhen && !node.includeWhen(ctx)) continue;
    const letter = APPENDIX_LETTERS[appendixIndex] ?? String(appendixIndex + 1);
    appendixIndex += 1;
    const section = renderNode(
      node,
      `Приложение ${letter}`,
      ctx,
      gaps,
      issues,
      printedGaps,
      gapRegistryRef,
    );
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
  printedGaps: Set<string>,
  gapRegistryRef?: string,
): Gost34Section {
  const content: SectionContent = node.build ? node.build(ctx) : {};
  const paragraphs: string[] = [...(content.paragraphs || [])];

  (content.items || []).forEach((item, idx) => {
    paragraphs.push(`${numStr}.${idx + 1} ${item}`);
  });

  if (content.gaps && content.gaps.length > 0) {
    const repeated: string[] = [];
    for (const g of content.gaps) {
      if (printedGaps.has(g.path)) {
        repeated.push(g.label);
        continue;
      }
      printedGaps.add(g.path);
      gaps.push(g);
      paragraphs.push(
        `${g.label} — ${CONTEXT_GAP_PLACEHOLDER}${g.hint ? ` (источник данных: ${g.hint})` : ''}.`,
      );
    }
    if (repeated.length > 0) {
      paragraphs.push(
        gapRegistryRef
          ? `Сведения, требующие уточнения и относящиеся к настоящему разделу: ${repeated.join(', ')} — приведены в ${gapRegistryRef}.`
          : `Сведения, требующие уточнения и относящиеся к настоящему разделу: ${repeated.join(', ')}.`,
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
    subsections.push(
      renderNode(child, `${numStr}.${childNumber}`, ctx, gaps, issues, printedGaps, gapRegistryRef),
    );
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

export { validateSchemaCoverage } from './coverage';
