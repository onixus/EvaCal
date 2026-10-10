// Pure, client-safe helpers for reusable GPL import profiles. A saved profile
// records each mapped column by position AND header name; applying it to a new
// file matches by header name so reordered columns keep working. Anything that
// cannot be matched unambiguously is reported and left unmapped for review.
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  type ImportField,
  type ImportProfile,
} from './import-types';

export const PROFILE_FORMATS = ['csv', 'xlsx'] as const;
export type ProfileFormat = (typeof PROFILE_FORMATS)[number];

export interface SavedColumn {
  index: number;
  header: string;
}
export interface SavedImportSettings {
  sheet: string;
  headerRow: number;
  startRow: number;
  delimiter: ImportProfile['delimiter'];
  decimalSeparator: ImportProfile['decimalSeparator'];
  currency: string;
  kind: ImportProfile['kind'];
  columns: Partial<Record<ImportField, SavedColumn>>;
  attributes: Array<SavedColumn & { name: string; unit: string }>;
  /** All headers of the file the profile was saved from, to detect new columns. */
  sourceHeaders: string[];
}
export interface SavedImportProfile {
  id: string;
  vendorId: string;
  name: string;
  format: ProfileFormat;
  revision: number;
  archived: boolean;
  settings: SavedImportSettings;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  /** Returned on save: mapped columns that cannot be matched by header later. */
  warnings?: string[];
}
export interface ProfileMatchReport {
  mismatches: string[];
  moved: string[];
  /** Headers present in the new file but absent from the profile's source file. */
  added: string[];
}

export function profileFormat(filename: string): ProfileFormat | null {
  return /\.csv$/i.test(filename) ? 'csv' : /\.xlsx$/i.test(filename) ? 'xlsx' : null;
}
export const normalizeHeader = (header: string) =>
  String(header ?? '')
    .replace(/[\s ]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');

/** Captures an analyzed profile with the header name of every mapped column. */
export function settingsFromProfile(
  profile: ImportProfile,
  headers: string[],
): SavedImportSettings {
  const header = (index: number) => String(headers[index] ?? '').trim();
  const columns: SavedImportSettings['columns'] = {};
  for (const field of IMPORT_FIELDS) {
    const index = profile.mapping[field];
    if (index !== undefined) columns[field] = { index, header: header(index) };
  }
  return {
    sheet: profile.sheet,
    headerRow: profile.headerRow,
    startRow: profile.startRow,
    delimiter: profile.delimiter,
    decimalSeparator: profile.decimalSeparator,
    currency: profile.currency,
    kind: profile.kind,
    columns,
    attributes: (profile.attributes ?? []).map((a) => ({
      index: a.column,
      header: header(a.column),
      name: a.name,
      unit: a.unit,
    })),
    sourceHeaders: headers.map((h) => String(h ?? '').trim()),
  };
}

function locate(
  saved: SavedColumn,
  headers: string[],
  label: string,
  report: ProfileMatchReport,
): number | undefined {
  const wanted = normalizeHeader(saved.header);
  // Columns are never matched by position: an untitled column must be chosen explicitly.
  if (!wanted) {
    report.mismatches.push(
      `${label}: колонка ${saved.index + 1} в профиле без заголовка — сопоставьте вручную`,
    );
    return undefined;
  }
  const found = headers
    .map((h, i) => (normalizeHeader(h) === wanted ? i : -1))
    .filter((i) => i >= 0);
  if (!found.length) {
    report.mismatches.push(`${label}: колонка «${saved.header}» не найдена в файле`);
    return undefined;
  }
  if (found.length > 1) {
    report.mismatches.push(
      `${label}: заголовок «${saved.header}» встречается в колонках ${found.map((i) => i + 1).join(', ')} — выберите вручную`,
    );
    return undefined;
  }
  if (found[0] !== saved.index)
    report.moved.push(`${label}: «${saved.header}» — колонка ${saved.index + 1} → ${found[0] + 1}`);
  return found[0];
}

/** Save-time warnings: columns that cannot be found by header name in later files. */
export function profileHeaderWarnings(settings: SavedImportSettings): string[] {
  const counts = new Map<string, number>();
  for (const h of settings.sourceHeaders) {
    const key = normalizeHeader(h);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const warnings: string[] = [];
  const check = (label: string, column: SavedColumn) => {
    const key = normalizeHeader(column.header);
    if (!key)
      warnings.push(
        `${label}: колонка ${column.index + 1} без заголовка — в следующих файлах ее нужно будет выбрать вручную`,
      );
    else if ((counts.get(key) ?? 0) > 1)
      warnings.push(
        `${label}: заголовок «${column.header}» повторяется в файле — в следующих файлах потребуется ручной выбор`,
      );
  };
  for (const field of IMPORT_FIELDS) {
    const column = settings.columns[field];
    if (column) check(IMPORT_FIELD_LABELS[field], column);
  }
  for (const a of settings.attributes) check(`Характеристика «${a.name}»`, a);
  return warnings;
}
/** Resolves a saved profile against the headers of a concrete file. */
export function applySavedSettings(
  settings: SavedImportSettings,
  vendorId: string,
  headers: string[],
  sheet: string,
): { profile: ImportProfile; report: ProfileMatchReport } {
  const report: ProfileMatchReport = { mismatches: [], moved: [], added: [] };
  const mapping: ImportProfile['mapping'] = {};
  for (const field of IMPORT_FIELDS) {
    const saved = settings.columns[field];
    if (!saved) continue;
    const index = locate(saved, headers, IMPORT_FIELD_LABELS[field], report);
    if (index !== undefined) mapping[field] = index;
  }
  const attributes: NonNullable<ImportProfile['attributes']> = [];
  for (const a of settings.attributes) {
    const index = locate(a, headers, `Характеристика «${a.name}»`, report);
    if (index !== undefined) attributes.push({ column: index, name: a.name, unit: a.unit });
  }
  const known = new Set(settings.sourceHeaders.map(normalizeHeader).filter(Boolean));
  report.added = headers
    .map((h) => String(h ?? '').trim())
    .filter((h) => h && !known.has(normalizeHeader(h)));
  return {
    profile: {
      vendorId,
      sheet,
      headerRow: settings.headerRow,
      startRow: settings.startRow,
      endRow: null,
      delimiter: settings.delimiter,
      decimalSeparator: settings.decimalSeparator,
      currency: settings.currency,
      kind: settings.kind,
      mapping,
      attributes,
    },
    report,
  };
}
