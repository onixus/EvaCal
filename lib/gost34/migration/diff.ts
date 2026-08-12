import { analyzeAndNormalizeInput } from '../analyzer';
import { buildGost34DocumentAST } from '../generator';
import { resolveGost34Profile } from '../standards';
import type { CitationKey, StandardProfile } from '../standards/types';
import type { Gost34DocumentAST, Gost34RequirementItem, Gost34Section } from '../types';
import type { GostDocumentType } from '../types';
import type { ProjectContext } from '../context/types';
import type {
  MigrationApplicabilityGap,
  MigrationDiff,
  MigrationProfileRef,
  MigrationReferenceChange,
  MigrationRequirementRef,
  MigrationSectionMove,
  MigrationSectionRef,
  MigrationStructureDiff,
} from './types';

/** Ключи цитат, за которыми закреплены обозначения стандартов. */
const CITATION_KEYS: CitationKey[] = [
  'primary',
  'documentsClassifier',
  'projectDocumentation',
  'lifecycle',
  'testing',
  'specificationBasis',
];

export interface MigrationDiffInput {
  calculation?: Parameters<typeof analyzeAndNormalizeInput>[0]['calculation'];
  docType?: GostDocumentType;
  /** Профиль, по которому проект выпускался. */
  fromProfileId: string;
  /** Профиль, на который выполняется миграция. */
  toProfileId: string;
  rawRequirements?: Gost34RequirementItem[];
  vendorFiles?: string[];
  projectContext?: Partial<ProjectContext>;
}

function toProfileRef(profile: StandardProfile): MigrationProfileRef {
  return {
    id: profile.id,
    name: profile.name,
    version: profile.version,
    primaryStandard: profile.citations.primary,
  };
}

/** Сравнение заголовков без учёта регистра, пунктуации и лишних пробелов. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

function flattenSections(sections: Gost34Section[]): MigrationSectionRef[] {
  const flat: MigrationSectionRef[] = [];
  const walk = (list: Gost34Section[]) => {
    for (const section of list) {
      flat.push({ id: section.id, numStr: section.numStr, title: section.title });
      if (section.subsections?.length) walk(section.subsections);
    }
  };
  walk(sections);
  return flat;
}

function diffStructure(from: Gost34Section[], to: Gost34Section[]): MigrationStructureDiff {
  const fromFlat = flattenSections(from);
  const toFlat = flattenSections(to);

  const fromByTitle = new Map(fromFlat.map((s) => [titleKey(s.title), s]));
  const toByTitle = new Map(toFlat.map((s) => [titleKey(s.title), s]));

  const added = toFlat.filter((s) => !fromByTitle.has(titleKey(s.title)));
  const removed = fromFlat.filter((s) => !toByTitle.has(titleKey(s.title)));

  const renumbered: MigrationSectionMove[] = [];
  let unchanged = 0;

  for (const section of toFlat) {
    const previous = fromByTitle.get(titleKey(section.title));
    if (!previous) continue;
    if (previous.numStr === section.numStr) {
      unchanged += 1;
      continue;
    }
    renumbered.push({ ...section, previousNumStr: previous.numStr });
  }

  return { added, removed, renumbered, unchanged };
}

/** Весь текст документа: заголовки, абзацы и содержимое таблиц. */
function documentText(ast: Gost34DocumentAST): string {
  const parts: string[] = [];
  const walk = (sections: Gost34Section[]) => {
    for (const section of sections) {
      parts.push(section.title, ...section.paragraphs);
      for (const table of section.tables || []) {
        if (table.caption) parts.push(table.caption);
        parts.push(...table.headers);
        for (const row of table.rows) parts.push(...row.map(String));
      }
      if (section.subsections?.length) walk(section.subsections);
    }
  };
  walk(ast.sections);
  return parts.join('\n');
}

/**
 * Обозначения стандартов прежней редакции, которые встречались в документе и
 * исчезают после миграции. Замена берётся из той же цитаты нового профиля.
 */
function diffLegacyReferences(
  fromProfile: StandardProfile,
  toProfile: StandardProfile,
  fromText: string,
  toText: string,
): MigrationReferenceChange[] {
  const changes = new Map<string, MigrationReferenceChange>();

  const consider = (citation: string, replacedBy?: string) => {
    const trimmed = citation.trim();
    if (!trimmed || changes.has(trimmed)) return;
    if (!fromText.includes(trimmed) || toText.includes(trimmed)) return;
    changes.set(trimmed, { citation: trimmed, replacedBy });
  };

  for (const key of CITATION_KEYS) {
    consider(fromProfile.citations[key], toProfile.citations[key]);
  }

  const toStandardTitles = [
    toProfile.primaryStandard,
    ...toProfile.documentStandards,
    ...toProfile.lifecycleStandards,
    ...toProfile.testingStandards,
  ]
    .map((std) => std.title)
    .join('\n');

  for (const std of [
    fromProfile.primaryStandard,
    ...fromProfile.documentStandards,
    ...fromProfile.lifecycleStandards,
    ...fromProfile.testingStandards,
  ]) {
    // Обозначение стандарта — первое «слово» его заголовка до названия.
    const designation = std.title.split(/\s{2,}|\s(?=[А-ЯЁ][а-яё])/)[0];
    if (toStandardTitles.includes(designation)) continue;
    consider(designation, toProfile.citations.primary);
  }

  for (const doc of fromProfile.documentTypes) {
    const twin = toProfile.documentTypes.find((d) => d.docType === doc.docType);
    consider(doc.standardCitation, twin?.standardCitation);
  }

  return [...changes.values()];
}

function toRequirementRefs(
  items: Gost34RequirementItem[] = [],
): Map<string, MigrationRequirementRef> {
  return new Map(
    items.map((item) => [
      item.code,
      { code: item.code, title: item.title, category: item.category as string },
    ]),
  );
}

/**
 * Строит предварительный просмотр миграции: документ собирается дважды — по
 * прежнему и по целевому профилю — и результаты сравниваются. Ни расчёт, ни
 * привязка проекта при этом не изменяются.
 */
export function buildMigrationDiff(input: MigrationDiffInput): MigrationDiff {
  const docType: GostDocumentType = input.docType || 'TZ';
  const fromProfile = resolveGost34Profile(input.fromProfileId);
  const toProfile = resolveGost34Profile(input.toProfileId);

  const build = (profileId: string) => {
    const payload = analyzeAndNormalizeInput({
      calculation: input.calculation,
      rawRequirements: input.rawRequirements,
      vendorFiles: input.vendorFiles,
      projectContext: input.projectContext,
      metadataOverride: { docType, standardProfileId: profileId },
    });
    return { payload, ast: buildGost34DocumentAST(payload) };
  };

  const before = build(fromProfile.id);
  const after = build(toProfile.id);

  const beforeRequirements = toRequirementRefs(before.payload.customRequirements);
  const afterRequirements = toRequirementRefs(after.payload.customRequirements);

  const addedRequirements = [...afterRequirements.entries()]
    .filter(([code]) => !beforeRequirements.has(code))
    .map(([, ref]) => ref);
  const removedRequirements = [...beforeRequirements.entries()]
    .filter(([code]) => !afterRequirements.has(code))
    .map(([, ref]) => ref);

  const inapplicableRegulations: MigrationApplicabilityGap[] = (after.payload.applicability || [])
    .filter((result) => result.finalStatus !== 'APPLICABLE')
    .map((result) => ({
      standardId: result.standardId,
      title: result.title,
      status: result.finalStatus as MigrationApplicabilityGap['status'],
      reason: result.reasons[0] || 'Причина не указана.',
    }));

  const conflicts = (after.payload.validation?.findings || []).filter(
    (finding) => finding.severity === 'ERROR',
  );

  const schemaIssues = after.ast.diagnostics.issues;
  const blockingGaps = after.ast.diagnostics.gaps
    .filter((gap) => gap.severity === 'blocking')
    .map((gap) => ({ path: gap.path, label: gap.label }));

  return {
    docType,
    from: toProfileRef(fromProfile),
    to: toProfileRef(toProfile),
    alreadyMigrated: fromProfile.id === toProfile.id,
    structure: diffStructure(before.ast.sections, after.ast.sections),
    removedLegacyReferences: diffLegacyReferences(
      fromProfile,
      toProfile,
      documentText(before.ast),
      documentText(after.ast),
    ),
    addedRequirements,
    removedRequirements,
    conflicts,
    schemaIssues,
    inapplicableRegulations,
    blockingGaps,
    requiresAttention: conflicts.length > 0 || schemaIssues.length > 0 || blockingGaps.length > 0,
  };
}
