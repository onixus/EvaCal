/**
 * Общая часть маршрутов проверок приёмки: комплект из адреса, проверка прав.
 *
 * Чтение — любой, кому доступен расчёт комплекта на чтение (включая гостя по
 * share-ссылке со scope `read`). Запись — только вошедший сотрудник с ролью,
 * проводящей испытания (`canRecordAcceptance`): share-ссылка записи не даёт.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess, type AccessContext } from '@/lib/access';
import { canRecordAcceptance, EVIDENCE_MAX_BYTES, isPackageEligibleForChecks } from './rules';
import type { Gost34AcceptanceFacts } from '@/lib/gost34/types';
import { AcceptanceSourceError, loadAcceptanceFacts, needsAcceptanceFacts } from './decisionStore';

export type PackageRow = NonNullable<Awaited<ReturnType<typeof prisma.gostPackage.findUnique>>>;

export interface AcceptanceActor {
  /** User.id сотрудника или `share:<calc>` гостя. */
  id: string;
  /** Подпись в журнале: логин сотрудника. */
  name: string;
  role: string | null;
}

export function actorOf(access: AccessContext): AcceptanceActor {
  if (access.kind === 'staff' && access.session) {
    return {
      id: access.session.userId,
      name: access.session.username || access.session.userId,
      role: access.session.role,
    };
  }
  return { id: access.actorId, name: access.actorId, role: null };
}

export async function loadPackageForRead(
  req: NextRequest,
  packageId: string,
): Promise<NextResponse | { pkg: PackageRow; access: AccessContext; actor: AcceptanceActor }> {
  const pkg = await prisma.gostPackage.findUnique({ where: { id: packageId } });
  if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });
  const access = await requireCalcAccess(req, pkg.calculationId, ['read']);
  if (access instanceof NextResponse) return access;
  return { pkg, access, actor: actorOf(access) };
}

/**
 * Комплект для записи: доступ на чтение, сотрудник с ролью испытаний и
 * утверждённая редакция. Порядок важен: гость получает 403, а не сведения о
 * статусе комплекта.
 */
export async function loadPackageForWrite(
  req: NextRequest,
  packageId: string,
): Promise<NextResponse | { pkg: PackageRow; access: AccessContext; actor: AcceptanceActor }> {
  const loaded = await loadPackageForRead(req, packageId);
  if (loaded instanceof NextResponse) return loaded;
  if (loaded.access.kind !== 'staff' || !canRecordAcceptance(loaded.actor.role)) {
    return NextResponse.json(
      { error: 'Результаты испытаний записывают архитектор, ГАП или администратор' },
      { status: 403 },
    );
  }
  if (!isPackageEligibleForChecks(loaded.pkg)) {
    return NextResponse.json(
      { error: 'Проверки ведутся только для утверждённой редакции комплекта' },
      { status: 409 },
    );
  }
  return loaded;
}

/** Запас на заголовки multipart поверх размера файла. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * Разбор multipart-загрузки вложения с ограничением размера до декодирования:
 * сначала по Content-Length, затем по фактическому потоку (браузер или прокси
 * могут не прислать Content-Length). Как `lib/catalog/import-body.ts`.
 */
export async function evidenceFormData(req: Request): Promise<FormData | NextResponse> {
  const limit = EVIDENCE_MAX_BYTES + MULTIPART_OVERHEAD;
  const tooLarge = () => NextResponse.json({ error: 'Файл больше 10 МБ' }, { status: 413 });
  if (Number(req.headers.get('content-length')) > limit) return tooLarge();
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: bytes,
    }).formData();
  } catch {
    return NextResponse.json({ error: 'Некорректная multipart-загрузка' }, { status: 400 });
  }
}

/**
 * Факты испытаний для выгрузки ПСИ/акта (или комплекта, где они есть).
 * `packageId` — явный выбор редакции (`acceptancePackageId`); без него берётся
 * последняя утверждённая редакция расчёта с проверками. Другим документам
 * факты не нужны — запрос в БД не делается.
 */
export async function acceptanceFactsFor(
  calculationId: string,
  docTypes: string[],
  packageId: unknown,
): Promise<NextResponse | Gost34AcceptanceFacts | undefined> {
  const upper = docTypes.map((d) => String(d).toUpperCase());
  if (!needsAcceptanceFacts(upper)) return undefined;
  if (
    packageId !== undefined &&
    packageId !== null &&
    packageId !== '' &&
    typeof packageId !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Некорректная редакция для фактов испытаний' },
      { status: 400 },
    );
  }
  try {
    return await loadAcceptanceFacts({ calculationId, packageId: (packageId as string) || null });
  } catch (err) {
    if (err instanceof AcceptanceSourceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Ссылка на источник фактов для снимка выпуска. */
export function acceptanceSnapshot(facts: Gost34AcceptanceFacts | undefined) {
  return facts
    ? {
        packageId: facts.packageId,
        packageVersion: facts.packageVersion,
        decisionId: facts.decision?.id ?? null,
      }
    : undefined;
}
