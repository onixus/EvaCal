import { prisma } from '../prisma';
import { SpecificationError } from '../specification/validation';
import { text, revision } from './validation';
import { analyzeImport, importProfile } from './import-parser';
import {
  applySavedSettings,
  profileFormat,
  type SavedImportSettings,
} from './import-profile-match';
import type { ProfileApplication } from './import-types';
import type { Prisma } from '../generated/prisma/client';

export type Analysis = ReturnType<typeof analyzeImport> & {
  profileApplication?: ProfileApplication | null;
};
/**
 * Analyzes a file with a saved profile: columns are found by header name in this
 * file; missing/ambiguous headers stay unmapped and are reported. The client's
 * expected revision guards against applying a profile changed by someone else.
 */
export async function analyzeWithSavedProfile(
  bytes: Uint8Array,
  filename: string,
  input: Record<string, unknown>,
  vendorId?: string,
  db: Pick<Prisma.TransactionClient, 'catalogImportProfile'> = prisma,
): Promise<Analysis> {
  const id = text(input.savedProfileId, 'Профиль', 100, true),
    expected = revision(input.savedProfileRevision);
  const saved = await db.catalogImportProfile.findUnique({ where: { id } });
  if (!saved || saved.archived) throw new SpecificationError('Профиль не найден', 404);
  if (saved.revision !== expected)
    throw new SpecificationError('Профиль изменен. Обновите список профилей.', 409);
  if (vendorId !== undefined && saved.vendorId !== vendorId)
    throw new SpecificationError('Профиль относится к другому вендору');
  if (profileFormat(filename) !== saved.format)
    throw new SpecificationError(`Профиль предназначен для ${saved.format.toUpperCase()}`);
  const settings = saved.profile as unknown as SavedImportSettings;
  const base = {
    vendorId: saved.vendorId,
    sheet: settings.sheet,
    headerRow: settings.headerRow,
    startRow: settings.startRow,
    delimiter: settings.delimiter,
    decimalSeparator: settings.decimalSeparator,
    currency: settings.currency,
    kind: settings.kind,
    mapping: {},
  };
  const sheetNotes: string[] = [];
  let probe: ReturnType<typeof analyzeImport>;
  try {
    probe = analyzeImport(bytes, filename, importProfile(base));
  } catch (e) {
    if (!(e instanceof SpecificationError) || e.message !== 'Лист не найден' || !settings.sheet)
      throw e;
    sheetNotes.push(`Лист «${settings.sheet}» не найден — проанализирован первый лист`);
    probe = analyzeImport(bytes, filename, importProfile({ ...base, sheet: '' }));
  }
  const { profile, report } = applySavedSettings(
    settings,
    saved.vendorId,
    probe.headers.map(String),
    probe.profile.sheet,
  );
  return {
    ...analyzeImport(bytes, filename, importProfile(profile)),
    profileApplication: {
      profileId: saved.id,
      profileRevision: saved.revision,
      name: saved.name,
      mismatches: [...sheetNotes, ...report.mismatches],
      moved: report.moved,
      added: report.added,
    },
  };
}
