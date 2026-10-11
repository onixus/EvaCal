/**
 * Сид встроенных наборов решений (#103 WP-7a): отраслевые пресеты и шаблоны
 * ТЗ из кода становятся системными наборами с утверждённой версией 1.
 * Вызывается из `prisma/seed.ts` (контейнер migrate запускает сид при каждом
 * старте), поэтому идемпотентен: набор с тем же ключом не трогается — даже если
 * пресет в коде изменился. Обновление встроенного набора — новая версия через
 * библиотеку, а не перезапись v1 (на неё могут ссылаться проекты).
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { builtinKits, type BuiltinKit } from './builtin';
import { checkKitContent } from './content';

export const SYSTEM_ACTOR = 'system';

export interface SeedKitsResult {
  created: string[];
  skipped: string[];
}

/** Ошибки целостности встроенного набора — ошибка кода, сид падает громко. */
function assertBuiltinValid(kit: BuiltinKit) {
  const checked = checkKitContent(kit.content);
  const issues = [...checked.shapeIssues, ...checked.issues];
  if (issues.length > 0) {
    throw new Error(
      `Встроенный набор ${kit.key} некорректен: ${issues
        .slice(0, 5)
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    );
  }
}

export async function seedBuiltinSolutionKits(
  kits: BuiltinKit[] = builtinKits(),
): Promise<SeedKitsResult> {
  const result: SeedKitsResult = { created: [], skipped: [] };
  const existing = new Set(
    (
      await prisma.solutionKit.findMany({
        where: { key: { in: kits.map((k) => k.key) } },
        select: { key: true },
      })
    ).map((k) => k.key),
  );
  const now = new Date();
  for (const kit of kits) {
    if (existing.has(kit.key)) {
      result.skipped.push(kit.key);
      continue;
    }
    assertBuiltinValid(kit);
    try {
      await prisma.solutionKit.create({
        data: {
          key: kit.key,
          name: kit.name,
          scope: kit.scope as unknown as Prisma.InputJsonValue,
          source: kit.source,
          status: 'approved',
          ownerId: null,
          ownerName: null,
          createdBy: SYSTEM_ACTOR,
          versions: {
            create: {
              version: 1,
              status: 'approved',
              content: kit.content as unknown as Prisma.InputJsonValue,
              changelog: kit.changelog,
              createdBy: SYSTEM_ACTOR,
              approvedBy: SYSTEM_ACTOR,
              approvedAt: now,
            },
          },
        },
      });
      result.created.push(kit.key);
    } catch (e) {
      // Параллельный сид успел создать тот же набор — это не ошибка.
      if ((e as { code?: string })?.code === 'P2002') {
        result.skipped.push(kit.key);
        continue;
      }
      throw e;
    }
  }
  return result;
}
