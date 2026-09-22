import { analyzeAndNormalizeInput } from '../analyzer';
import { buildGost34DocumentAST } from '../generator';
import { LEGACY_GOST34_PROFILE_ID } from '../standards';
import { TZ_SCHEMA_2020 } from '../schema/tz34-2020';
import { validateSchemaCoverage } from '../schema/coverage';
import { overlaysForDocument } from '../llm/tzAuthor/project';
import { validateTzAuthorProposals, TzAuthorHardFlagsError } from '../llm/tzAuthor/validate';
import type { TzAuthorDiagnostic, TzAuthorState } from '../llm/tzAuthor/types';
import { applySectionOverrides } from './overrides';
import { Gost34StructureError } from './errors';

export type Gost34GenerationParams = Parameters<typeof analyzeAndNormalizeInput>[0] & {
  sectionOverrides?: Record<string, { title?: string; paragraphs?: string[] }>;
  tzAuthor?: TzAuthorState;
};

/** One preparation path for preview and export. Preview can show rejected edits with diagnostics. */
export function prepareGost34Document(
  params: Gost34GenerationParams,
  options: { mode?: 'preview' | 'export'; includeProposed?: boolean } = {},
) {
  const preview = options.mode === 'preview';
  const includeProposed = preview && Boolean(options.includeProposed);
  const payload = analyzeAndNormalizeInput(params);
  const baselineAst = buildGost34DocumentAST(payload);
  const docType = payload.metadata.docType || 'TZ';
  let validTzAuthor = params.tzAuthor;
  let tzAuthorDiagnostics: TzAuthorDiagnostic[] = [];

  if (docType === 'TZ' && params.tzAuthor) {
    const validation = validateTzAuthorProposals({
      payload,
      context: payload.projectContext,
      tzAuthor: params.tzAuthor,
      checkProposed: includeProposed,
    });
    validTzAuthor = validation.validTzAuthor;
    tzAuthorDiagnostics = validation.diagnostics;
    if (!preview && tzAuthorDiagnostics.length > 0) {
      throw new TzAuthorHardFlagsError(tzAuthorDiagnostics);
    }
  }

  const overrides = overlaysForDocument({
    docType,
    sectionOverrides: params.sectionOverrides,
    tzAuthor: validTzAuthor,
    includeProposed,
  });
  const sections = applySectionOverrides(baselineAst.sections, overrides);
  const issues = docType === 'TZ' && payload.standardProfile.id !== LEGACY_GOST34_PROFILE_ID
    ? validateSchemaCoverage(TZ_SCHEMA_2020, sections)
    : baselineAst.diagnostics.issues;
  const diagnostics = { ...baselineAst.diagnostics, issues };
  const ast = { ...baselineAst, sections, diagnostics };

  if (!preview && issues.length > 0) throw new Gost34StructureError(issues);
  return { ast, baselineAst, diagnostics, tzAuthorDiagnostics };
}
