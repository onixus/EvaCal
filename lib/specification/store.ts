import { prisma } from '../prisma';
import {
  parseSpecification,
  requireConfirmedSpecification,
  SpecificationError,
} from './validation';
import type { SavedSpecification } from './types';

export async function loadSpecification(
  calculationId: string,
  version?: number,
): Promise<SavedSpecification | null> {
  const row = await prisma.specificationVersion.findFirst({
    where: { calculationId, ...(version === undefined ? {} : { version }) },
    orderBy: { version: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    snapshot: parseSpecification(JSON.parse(row.data)),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/** Serialize writes per calculation; stale editors cannot overwrite another revision. */
export async function saveSpecification(calculationId: string, input: unknown, actorId: string) {
  const snapshot = parseSpecification(input);
  if (snapshot.status === 'confirmed') requireConfirmedSpecification(snapshot);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Calculation" WHERE id = ${calculationId} FOR UPDATE
    `;
    if (!rows.length) throw new SpecificationError('Расчет не найден', 404);
    const latest = await tx.specificationVersion.findFirst({
      where: { calculationId },
      orderBy: { version: 'desc' },
    });
    if ((latest?.version ?? 0) !== snapshot.version) {
      throw new SpecificationError(
        'Спецификация изменена другим пользователем. Загрузите последнюю версию.',
        409,
      );
    }
    const next = { ...snapshot, version: snapshot.version + 1 };
    const row = await tx.specificationVersion.create({
      data: {
        calculationId,
        version: next.version,
        status: next.status,
        data: JSON.stringify(next),
        createdBy: actorId,
      },
    });
    return {
      id: row.id,
      snapshot: next,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    };
  });
}
