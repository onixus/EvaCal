import { prisma } from '../prisma';
import { SpecificationError } from '../specification/validation';
import { object, text, revision } from './validation';
import { importProfile } from './import-parser';
import { loadImport } from './import-store';
import {
  profileFormat,
  settingsFromProfile,
  type SavedImportProfile,
  type SavedImportSettings,
} from './import-profile-match';
import type { Prisma } from '../generated/prisma/client';

type ProfileRecord = Awaited<ReturnType<typeof prisma.catalogImportProfile.findUniqueOrThrow>>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function view(p: ProfileRecord): SavedImportProfile {
  return {
    id: p.id,
    vendorId: p.vendorId,
    name: p.name,
    format: p.format as SavedImportProfile['format'],
    revision: p.revision,
    archived: p.archived,
    settings: p.profile as unknown as SavedImportSettings,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedBy: p.updatedBy,
    updatedAt: p.updatedAt.toISOString(),
  };
}
export async function listImportProfiles(vendorId?: string): Promise<SavedImportProfile[]> {
  const where =
    vendorId === undefined
      ? { archived: false }
      : { archived: false, vendorId: text(vendorId, 'Вендор', 100, true) };
  const rows = await prisma.catalogImportProfile.findMany({
    where,
    orderBy: [{ name: 'asc' }, { format: 'asc' }, { id: 'asc' }],
    take: 500,
  });
  return rows.map(view);
}
/** Settings come only from an analyzed draft, so mapped headers are the real file headers. */
async function settingsFromImport(importId: unknown) {
  const draft = await loadImport(text(importId, 'Пакет GPL', 100, true));
  const format = profileFormat(draft.filename);
  if (!format) throw new SpecificationError('Неизвестный формат пакета');
  const settings = settingsFromProfile(importProfile(draft.profile), draft.headers);
  if (!Object.keys(settings.columns).length && !settings.attributes.length)
    throw new SpecificationError('Сопоставьте хотя бы одну колонку перед сохранением профиля');
  return { vendorId: draft.profile.vendorId, format, settings };
}
const uniqueConflict = (e: unknown) =>
  (e as { code?: string })?.code === 'P2002'
    ? new SpecificationError('Профиль с таким названием для этого вендора и формата уже есть', 409)
    : e;
export async function mutateImportProfile(input: unknown, actorId: string) {
  const d = object(input);
  if (d.action === 'create') {
    const name = text(d.name, 'Название профиля', 100, true);
    const source = await settingsFromImport(d.importId);
    try {
      return view(
        await prisma.$transaction(async (tx) => {
          const vendor = await tx.catalogVendor.findUnique({ where: { id: source.vendorId } });
          if (!vendor || vendor.archived)
            throw new SpecificationError('Выберите действующего вендора', 409);
          return tx.catalogImportProfile.create({
            data: {
              vendorId: source.vendorId,
              name,
              format: source.format,
              profile: json(source.settings),
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
        }),
      );
    } catch (e) {
      throw uniqueConflict(e);
    }
  }
  const id = text(d.id, 'Профиль', 100, true),
    expected = revision(d.revision);
  if (d.action !== 'update' && d.action !== 'archive')
    throw new SpecificationError('Неизвестное действие профиля');
  const current = await prisma.catalogImportProfile.findUnique({ where: { id } });
  if (!current) throw new SpecificationError('Профиль не найден', 404);
  let data: Prisma.CatalogImportProfileUpdateManyMutationInput = { archived: true };
  if (d.action === 'update') {
    const source = await settingsFromImport(d.importId);
    if (source.vendorId !== current.vendorId || source.format !== current.format)
      throw new SpecificationError(
        'Профиль можно обновить только по файлу того же вендора и формата',
      );
    data = {
      profile: json(source.settings),
      ...(d.name === undefined ? {} : { name: text(d.name, 'Название профиля', 100, true) }),
    };
  }
  try {
    const result = await prisma.catalogImportProfile.updateMany({
      where: { id, revision: expected, archived: false },
      data: { ...data, revision: { increment: 1 }, updatedBy: actorId, updatedAt: new Date() },
    });
    if (!result.count)
      throw new SpecificationError('Профиль изменен или архивирован. Обновите список.', 409);
  } catch (e) {
    throw uniqueConflict(e);
  }
  return view(await prisma.catalogImportProfile.findUniqueOrThrow({ where: { id } }));
}
