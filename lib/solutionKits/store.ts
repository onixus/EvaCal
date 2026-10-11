/**
 * Библиотека решений (#103 WP-7a): работа с БД. Правила — `./rules.ts`,
 * схема содержимого — `./content.ts`, описание — docs/solution-library.md.
 *
 * Неизменность утверждённых версий держит триггер `SolutionKitVersion_guard`;
 * здесь те же переходы проверяются заранее, чтобы ответить 409 с понятной
 * причиной, а не ошибкой СУБД. Смена статуса — условным `updateMany` по
 * ожидаемому статусу: параллельный запрос получит count = 0 и 409.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import {
  checkKitContent,
  emptyKitContent,
  kitContentStats,
  KIT_KEY_PATTERN,
  parseKitContent,
  parseKitScope,
  type KitContentIssue,
  type KitScope,
  type SolutionKitContent,
} from './content';
import { diffKitVersions, type KitVersionDiff } from './diff';
import {
  canEditKitDrafts,
  canGovernKit,
  canTransitionVersion,
  isVersionEditable,
  nextKitStatusOnRestore,
  type KitActor,
  type KitVersionStatus,
} from './rules';

export type KitResult<T> =
  ({ ok: true } & T) | { ok: false; status: number; error: string; issues?: KitContentIssue[] };

export interface KitActorWithName extends KitActor {
  username: string;
}

const MAX_NAME = 300;
const MAX_CHANGELOG = 10_000;
const MAX_SOURCE = 200;

const fail = (status: number, error: string, issues?: KitContentIssue[]) =>
  ({ ok: false, status, error, ...(issues ? { issues } : {}) }) as const;

function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string };
  return err.code === 'P2002' || err.code === '23505' || /23505|unique/i.test(err.message ?? '');
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Содержимое из БД: невалидная форма (ручная правка в обход API) — пустое. */
export function storedContent(raw: unknown): SolutionKitContent {
  return parseKitContent(raw).content ?? emptyKitContent();
}

const versionMeta = {
  id: true,
  version: true,
  status: true,
  changelog: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  approvedBy: true,
  approvedAt: true,
  archivedBy: true,
  archivedAt: true,
} as const;

// ── Чтение ───────────────────────────────────────────────────────────────

export async function listKits() {
  const kits = await prisma.solutionKit.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      versions: { select: { version: true, status: true }, orderBy: { version: 'desc' } },
    },
  });
  return kits.map(({ versions, ...kit }) => ({
    ...kit,
    latestVersion: versions[0]?.version ?? null,
    currentVersion: versions.find((v) => v.status === 'approved')?.version ?? null,
    draftVersion: versions.find((v) => v.status === 'draft')?.version ?? null,
    versionCount: versions.length,
  }));
}

export async function getKit(kitId: string) {
  return prisma.solutionKit.findUnique({
    where: { id: kitId },
    include: { versions: { select: versionMeta, orderBy: { version: 'desc' } } },
  });
}

export async function getKitVersion(kitId: string, version: number) {
  const row = await prisma.solutionKitVersion.findUnique({
    where: { kitId_version: { kitId, version } },
  });
  if (!row) return null;
  const content = storedContent(row.content);
  return {
    ...row,
    content,
    stats: kitContentStats(content),
    issues: checkKitContent(row.content).issues,
  };
}

/**
 * Разница версии с другой версией того же набора; по умолчанию — с ближайшей
 * предыдущей (любого статуса). Для первой версии все элементы — добавленные.
 */
export async function diffKitVersion(
  kitId: string,
  version: number,
  against?: number,
): Promise<KitResult<{ diff: KitVersionDiff }>> {
  const to = await prisma.solutionKitVersion.findUnique({
    where: { kitId_version: { kitId, version } },
  });
  if (!to) return fail(404, 'Версия не найдена');
  const from =
    against !== undefined
      ? await prisma.solutionKitVersion.findUnique({
          where: { kitId_version: { kitId, version: against } },
        })
      : await prisma.solutionKitVersion.findFirst({
          where: { kitId, version: { lt: version } },
          orderBy: { version: 'desc' },
        });
  if (against !== undefined && !from) return fail(404, `Версия ${against} не найдена`);
  return {
    ok: true,
    diff: diffKitVersions(
      from ? { version: from.version, content: storedContent(from.content) } : null,
      { version: to.version, content: storedContent(to.content) },
    ),
  };
}

// ── Набор ────────────────────────────────────────────────────────────────

export interface KitPassportInput {
  key?: unknown;
  name?: unknown;
  scope?: unknown;
  source?: unknown;
}

function passportText(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null;
}

/** Новый набор с черновиком v1 (пустым или из переданного содержимого). */
export async function createKit(
  actor: KitActorWithName,
  input: KitPassportInput & { content?: unknown; changelog?: unknown },
): Promise<KitResult<{ kit: { id: string; key: string }; issues: KitContentIssue[] }>> {
  if (!canEditKitDrafts(actor)) return fail(403, 'Недостаточно прав');
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!KIT_KEY_PATTERN.test(key)) {
    return fail(400, 'key: строчная латиница, цифры, . _ -; от 2 до 100 символов');
  }
  const name = passportText(input.name, MAX_NAME);
  if (!name) return fail(400, `Название обязательно (до ${MAX_NAME} символов)`);
  const scope = parseKitScope(input.scope);
  if (!scope) return fail(400, 'scope: { industries: string[], productTypes: string[], notes }');
  const source = input.source === undefined ? 'manual' : passportText(input.source, MAX_SOURCE);
  if (!source) return fail(400, `source: непустая строка до ${MAX_SOURCE} символов`);
  const checked = checkKitContent(input.content ?? emptyKitContent());
  if (!checked.content) return fail(400, 'Содержимое не соответствует схеме', checked.shapeIssues);
  const changelog = typeof input.changelog === 'string' ? input.changelog.trim() : '';
  if (changelog.length > MAX_CHANGELOG) return fail(400, 'Журнал изменений слишком длинный');

  try {
    const kit = await prisma.solutionKit.create({
      data: {
        key,
        name,
        scope: json(scope),
        source,
        ownerId: actor.userId,
        ownerName: actor.username,
        createdBy: actor.username,
        versions: {
          create: {
            version: 1,
            content: json(checked.content),
            changelog,
            createdBy: actor.username,
          },
        },
      },
      select: { id: true, key: true },
    });
    return { ok: true, kit, issues: checked.issues };
  } catch (e) {
    if (isUniqueViolation(e)) return fail(409, `Набор с ключом «${key}» уже есть`);
    throw e;
  }
}

/**
 * Паспорт набора: название, область применимости, источник, владелец, архив.
 * Ключ неизменен — на него ссылаются происхождение элементов и сид.
 */
export async function updateKitPassport(
  actor: KitActor,
  kitId: string,
  input: KitPassportInput & { ownerId?: unknown; status?: unknown },
): Promise<KitResult<{ kit: Awaited<ReturnType<typeof getKit>> }>> {
  const kit = await prisma.solutionKit.findUnique({ where: { id: kitId } });
  if (!kit) return fail(404, 'Набор не найден');
  if (!canGovernKit(actor, kit)) {
    return fail(403, 'Паспорт набора меняет владелец-архитектор или администратор');
  }
  if (input.key !== undefined && input.key !== kit.key) {
    return fail(400, 'Ключ набора не меняется');
  }

  const data: Prisma.SolutionKitUpdateInput = {};
  if (input.name !== undefined) {
    const name = passportText(input.name, MAX_NAME);
    if (!name) return fail(400, `Название обязательно (до ${MAX_NAME} символов)`);
    data.name = name;
  }
  if (input.scope !== undefined) {
    const scope = parseKitScope(input.scope);
    if (!scope) return fail(400, 'scope: { industries: string[], productTypes: string[], notes }');
    data.scope = json(scope);
  }
  if (input.source !== undefined) {
    const source = passportText(input.source, MAX_SOURCE);
    if (!source) return fail(400, `source: непустая строка до ${MAX_SOURCE} символов`);
    data.source = source;
  }
  if (input.ownerId !== undefined) {
    if (input.ownerId === null) {
      if (actor.role !== 'admin') return fail(403, 'Снять владельца может только администратор');
      data.ownerId = null;
      data.ownerName = null;
    } else {
      if (typeof input.ownerId !== 'string') return fail(400, 'ownerId: id пользователя или null');
      const owner = await prisma.user.findUnique({
        where: { id: input.ownerId },
        select: { id: true, username: true, role: true },
      });
      if (!owner) return fail(400, 'Пользователь не найден');
      if (owner.role !== 'architect' && owner.role !== 'admin') {
        return fail(400, 'Владельцем набора может быть архитектор или администратор');
      }
      data.ownerId = owner.id;
      data.ownerName = owner.username;
    }
  }
  if (input.status !== undefined) {
    if (input.status === 'archived') {
      data.status = 'archived';
    } else if (input.status === 'active') {
      if (kit.status !== 'archived') return fail(409, 'Набор не в архиве');
      const approved = await prisma.solutionKitVersion.count({
        where: { kitId, status: 'approved' },
      });
      data.status = nextKitStatusOnRestore(approved > 0);
    } else {
      return fail(400, "status: 'archived' или 'active' (вернуть из архива)");
    }
  }

  await prisma.solutionKit.update({ where: { id: kitId }, data });
  return { ok: true, kit: await getKit(kitId) };
}

// ── Версии ───────────────────────────────────────────────────────────────

/** Новый черновик: копия последней версии с номером max + 1. */
export async function createDraftVersion(
  actor: KitActorWithName,
  kitId: string,
): Promise<KitResult<{ version: { id: string; version: number } }>> {
  if (!canEditKitDrafts(actor)) return fail(403, 'Недостаточно прав');
  const kit = await prisma.solutionKit.findUnique({ where: { id: kitId } });
  if (!kit) return fail(404, 'Набор не найден');
  if (kit.status === 'archived') return fail(409, 'Набор в архиве: верните его, чтобы править');
  const latest = await prisma.solutionKitVersion.findFirst({
    where: { kitId },
    orderBy: { version: 'desc' },
  });
  if (latest?.status === 'draft') {
    return fail(409, `Черновик уже есть: версия ${latest.version}`);
  }
  try {
    const created = await prisma.solutionKitVersion.create({
      data: {
        kitId,
        version: (latest?.version ?? 0) + 1,
        content: json(latest ? storedContent(latest.content) : emptyKitContent()),
        changelog: '',
        createdBy: actor.username,
      },
      select: { id: true, version: true },
    });
    return { ok: true, version: created };
  } catch (e) {
    // Параллельное создание: уникальность (kitId, version) или одного черновика.
    if (isUniqueViolation(e)) return fail(409, 'Черновик уже создан параллельно');
    throw e;
  }
}

/** Правка черновика: содержимое (форма обязательна) и журнал изменений. */
export async function updateDraftVersion(
  actor: KitActor,
  kitId: string,
  version: number,
  input: { content?: unknown; changelog?: unknown },
): Promise<KitResult<{ issues: KitContentIssue[] }>> {
  if (!canEditKitDrafts(actor)) return fail(403, 'Недостаточно прав');
  const row = await prisma.solutionKitVersion.findUnique({
    where: { kitId_version: { kitId, version } },
    include: { kit: { select: { status: true } } },
  });
  if (!row) return fail(404, 'Версия не найдена');
  if (!isVersionEditable(row.status)) {
    return fail(409, 'Утверждённая версия неизменна: создайте новую версию');
  }
  if (row.kit.status === 'archived') return fail(409, 'Набор в архиве');

  const data: Prisma.SolutionKitVersionUpdateManyMutationInput = {};
  let issues: KitContentIssue[] = checkKitContent(row.content).issues;
  if (input.content !== undefined) {
    const checked = checkKitContent(input.content);
    if (!checked.content) {
      return fail(400, 'Содержимое не соответствует схеме', checked.shapeIssues);
    }
    data.content = json(checked.content);
    issues = checked.issues;
  }
  if (input.changelog !== undefined) {
    if (typeof input.changelog !== 'string' || input.changelog.length > MAX_CHANGELOG) {
      return fail(400, `changelog: строка до ${MAX_CHANGELOG} символов`);
    }
    data.changelog = input.changelog.trim();
  }
  const res = await prisma.solutionKitVersion.updateMany({
    where: { id: row.id, status: 'draft' },
    data,
  });
  if (res.count === 0) return fail(409, 'Версию утвердили параллельно');
  return { ok: true, issues };
}

export async function deleteDraftVersion(
  actor: KitActor,
  kitId: string,
  version: number,
): Promise<KitResult<object>> {
  if (!canEditKitDrafts(actor)) return fail(403, 'Недостаточно прав');
  const res = await prisma.solutionKitVersion.deleteMany({
    where: { kitId, version, status: 'draft' },
  });
  if (res.count === 0) return fail(409, 'Удалить можно только черновик');
  return { ok: true };
}

/**
 * Утверждение черновика: содержимое без замечаний целостности, журнал
 * изменений обязателен начиная со второй версии. Набор становится
 * утверждённым; прежние утверждённые версии не меняются.
 */
export async function approveVersion(
  actor: KitActorWithName,
  kitId: string,
  version: number,
): Promise<KitResult<{ version: number }>> {
  const row = await prisma.solutionKitVersion.findUnique({
    where: { kitId_version: { kitId, version } },
    include: { kit: true },
  });
  if (!row) return fail(404, 'Версия не найдена');
  if (!canGovernKit(actor, row.kit)) {
    return fail(403, 'Утверждает администратор или владелец набора с ролью архитектора');
  }
  if (!canTransitionVersion(row.status as KitVersionStatus, 'approved')) {
    return fail(409, 'Утвердить можно только черновик');
  }
  if (row.kit.status === 'archived') return fail(409, 'Набор в архиве');
  const checked = checkKitContent(row.content);
  if (!checked.content) return fail(409, 'Содержимое не соответствует схеме', checked.shapeIssues);
  if (checked.issues.length > 0) {
    return fail(409, 'Содержимое не прошло проверку целостности', checked.issues);
  }
  if (version > 1 && !row.changelog.trim()) {
    return fail(409, 'Опишите изменения версии (журнал изменений)');
  }
  const now = new Date();
  const ok = await prisma.$transaction(async (tx) => {
    const res = await tx.solutionKitVersion.updateMany({
      where: { id: row.id, status: 'draft' },
      data: {
        status: 'approved',
        approvedBy: actor.username,
        approvedAt: now,
        // Каноническая форма: то, что утверждено, совпадает с тем, что проверено.
        content: json(checked.content),
      },
    });
    if (res.count === 0) return false;
    if (row.kit.status === 'draft') {
      await tx.solutionKit.update({ where: { id: kitId }, data: { status: 'approved' } });
    }
    return true;
  });
  if (!ok) return fail(409, 'Версию изменили параллельно');
  return { ok: true, version };
}

/** Архив утверждённой версии: содержимое не меняется, ссылки на неё остаются. */
export async function archiveVersion(
  actor: KitActorWithName,
  kitId: string,
  version: number,
): Promise<KitResult<{ version: number }>> {
  const row = await prisma.solutionKitVersion.findUnique({
    where: { kitId_version: { kitId, version } },
    include: { kit: true },
  });
  if (!row) return fail(404, 'Версия не найдена');
  if (!canGovernKit(actor, row.kit)) {
    return fail(403, 'Архивирует администратор или владелец набора с ролью архитектора');
  }
  if (!canTransitionVersion(row.status as KitVersionStatus, 'archived')) {
    return fail(409, 'В архив переводится только утверждённая версия');
  }
  const res = await prisma.solutionKitVersion.updateMany({
    where: { id: row.id, status: 'approved' },
    data: { status: 'archived', archivedBy: actor.username, archivedAt: new Date() },
  });
  if (res.count === 0) return fail(409, 'Версию изменили параллельно');
  return { ok: true, version };
}

export type { KitScope };
