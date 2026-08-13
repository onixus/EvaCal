import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  GostDocumentType,
  MIGRATION_TARGET_PROFILE_ID,
  buildBindingUpdate,
  buildMigrationDiff,
  getGost34Profile,
  resolveProjectBinding,
} from '@/lib/gost34';
import { requireCalcAccess, requireStaff } from '@/lib/access';
import { clientIp, writeAudit } from '@/lib/audit';

/**
 * Миграция ранее выпущенных проектов на действующий нормативный профиль
 * (раздел 5 плана модернизации, PR-12).
 *
 * GET  — предварительный просмотр: что изменится в документе. Ничего не пишет.
 * POST — применение: меняет нормативную привязку расчёта и возвращает тот же diff.
 *
 * Доступ такой же, как у экспорта расчёта: маршрут работает только с уже
 * доступным расчётом и не обращается ни к каким внешним сервисам.
 */

async function loadCalculation(id: string) {
  return prisma.calculation.findUnique({
    where: { id },
    include: {
      template: { include: { fields: { orderBy: { order: 'asc' } } } },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
}

type LoadedCalculation = NonNullable<Awaited<ReturnType<typeof loadCalculation>>>;

function toDiffInput(
  calculation: LoadedCalculation,
  fromProfileId: string,
  docType: GostDocumentType,
) {
  return {
    calculation: {
      id: calculation.id,
      name: calculation.name,
      customer: calculation.customer,
      answers: calculation.answers,
      pmHours: calculation.pmHours,
      startDate: calculation.startDate,
      stages: calculation.stages,
      risks: calculation.risks,
      template: { name: calculation.template.name },
    },
    docType,
    fromProfileId,
    toProfileId: MIGRATION_TARGET_PROFILE_ID,
  };
}

function parseDocType(value: string | null | undefined): GostDocumentType {
  const allowed: GostDocumentType[] = ['TZ', 'PZ', 'AF', 'PMI', 'SPEC'];
  return allowed.includes(value as GostDocumentType) ? (value as GostDocumentType) : 'TZ';
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['read']);
  if (access instanceof NextResponse) return access;

  const calculation = await loadCalculation(params.id);
  if (!calculation) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const binding = resolveProjectBinding(calculation);
  const docType = parseDocType(req.nextUrl.searchParams.get('docType'));

  return NextResponse.json({
    binding,
    targetProfileId: MIGRATION_TARGET_PROFILE_ID,
    diff: buildMigrationDiff(toDiffInput(calculation, binding.standardProfileId, docType)),
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const auth = await requireStaff();
    if (auth instanceof NextResponse) return auth;

    const calculation = await loadCalculation(params.id);
    if (!calculation) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const docType = parseDocType(body?.docType);
    const targetProfileId: string = body?.targetProfileId || MIGRATION_TARGET_PROFILE_ID;

    const target = getGost34Profile(targetProfileId);
    if (!target) {
      return NextResponse.json(
        { error: `Неизвестный нормативный профиль: ${targetProfileId}` },
        { status: 400 },
      );
    }
    if (target.status !== 'stable') {
      return NextResponse.json(
        {
          error: `Профиль ${target.id} имеет статус ${target.status} и не может быть назначен проекту.`,
        },
        { status: 400 },
      );
    }

    const binding = resolveProjectBinding(calculation);

    // Diff считается до записи: пользователь подтверждает именно его.
    const diff = buildMigrationDiff({
      ...toDiffInput(calculation, binding.standardProfileId, docType),
      toProfileId: target.id,
    });

    const updated = await prisma.calculation.update({
      where: { id: calculation.id },
      data: buildBindingUpdate(target.id),
    });

    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'calculation.gost34.migrate',
      entityType: 'calculation',
      entityId: calculation.id,
      meta: { targetProfileId: target.id },
      ip: clientIp(req),
    });

    return NextResponse.json({ binding: resolveProjectBinding(updated), diff });
  } catch (err: any) {
    console.error('Error in GOST 34 migration endpoint:', err);
    return NextResponse.json({ error: err?.message || 'Migration failed' }, { status: 500 });
  }
}
