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
import { canRecordAcceptance, isPackageEligibleForChecks } from './rules';

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
