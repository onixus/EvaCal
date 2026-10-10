import { prisma } from '../prisma';
import type { Prisma } from '../generated/prisma/client';
import { evaluateRules, parseRules, SizingError } from './engine';
import {
  SIZING_METRIC_KINDS,
  type SizingOutputValue,
  type SizingProfileVersionView,
  type SizingProfileView,
  type SizingRunView,
  type SizingScenarioResult,
  type SizingVersionStatus,
} from './types';

type VersionRow = Prisma.SizingProfileVersionGetPayload<{ include: { profile: true } }>;
type RunRow = Prisma.SizingRunGetPayload<{
  include: { profileVersion: { include: { profile: true } } };
}>;

const KEY = /^[a-z][a-z0-9_-]{0,63}$/;

function obj(value: unknown, what = 'Запрос'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SizingError(`${what}: требуется объект`);
  return value as Record<string, unknown>;
}
function str(value: unknown, what: string, max = 200, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new SizingError(`${what}: строка до ${max} символов`);
  return value.trim();
}
function assumptionsList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50)
    throw new SizingError('Допущения: список до 50 строк');
  return value.map((a) => str(a, 'Допущение', 1000));
}

export function versionView(row: VersionRow): SizingProfileVersionView {
  return {
    id: row.id,
    profileId: row.profileId,
    profileKey: row.profile.key,
    profileName: row.profile.name,
    domain: row.profile.domain,
    version: row.version,
    status: row.status as SizingVersionStatus,
    rules: row.rules as unknown as SizingProfileVersionView['rules'],
    assumptions: (row.assumptions as unknown as string[]) ?? [],
    source: row.source,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
  };
}

export function runView(row: RunRow): SizingRunView {
  const scenarios = (row.scenarios as unknown as Omit<SizingScenarioResult, 'outputs'>[]) ?? [];
  const outputs = (row.outputs as unknown as Record<string, SizingOutputValue[]>) ?? {};
  return {
    id: row.id,
    calculationId: row.calculationId,
    source: row.source as SizingRunView['source'],
    profileVersionId: row.profileVersionId,
    profile: row.profileVersion
      ? {
          key: row.profileVersion.profile.key,
          name: row.profileVersion.profile.name,
          version: row.profileVersion.version,
        }
      : null,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    scenarios: scenarios.map((s) => ({ key: s.key, label: s.label })),
    outputs,
    results: scenarios.map((s) => ({ ...s, outputs: outputs[s.key] ?? [] })),
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProfiles(includeArchived = false): Promise<SizingProfileView[]> {
  const rows = await prisma.sizingProfile.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: { key: 'asc' },
    include: { versions: { orderBy: { version: 'desc' } } },
  });
  return rows.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    domain: p.domain,
    description: p.description,
    archived: p.archived,
    versions: p.versions.map((v) => versionView({ ...v, profile: p })),
  }));
}

export async function loadVersion(id: string): Promise<SizingProfileVersionView> {
  const row = await prisma.sizingProfileVersion.findUnique({
    where: { id },
    include: { profile: true },
  });
  if (!row) throw new SizingError('Версия профиля не найдена', 404);
  return versionView(row);
}

export async function createProfile(input: unknown, actorId: string) {
  const d = obj(input);
  const key = str(d.key, 'Ключ профиля', 64);
  if (!KEY.test(key))
    throw new SizingError('Ключ профиля: латиница в нижнем регистре, цифры, - и _');
  if (await prisma.sizingProfile.findUnique({ where: { key } }))
    throw new SizingError('Профиль с таким ключом уже существует', 409);
  const profile = await prisma.sizingProfile.create({
    data: {
      key,
      name: str(d.name, 'Название профиля'),
      domain: str(d.domain, 'Домен', 100),
      description: d.description === undefined ? '' : str(d.description, 'Описание', 2000, false),
      createdBy: actorId,
    },
  });
  return profile;
}

export async function setProfileArchived(profileId: string, archived: boolean) {
  const found = await prisma.sizingProfile.findUnique({ where: { id: profileId } });
  if (!found) throw new SizingError('Профиль не найден', 404);
  return prisma.sizingProfile.update({ where: { id: profileId }, data: { archived } });
}

/** Новая черновая версия: номер — следующий после последней версии профиля. */
export async function createVersion(profileId: string, input: unknown, actorId: string) {
  const d = obj(input);
  const rules = parseRules(d.rules);
  const assumptions = assumptionsList(d.assumptions ?? []);
  const source = str(d.source, 'Источник правил', 2000);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "SizingProfile" WHERE id = ${profileId} FOR UPDATE
    `;
    if (!locked.length) throw new SizingError('Профиль не найден', 404);
    const last = await tx.sizingProfileVersion.findFirst({
      where: { profileId },
      orderBy: { version: 'desc' },
    });
    const row = await tx.sizingProfileVersion.create({
      data: {
        profileId,
        version: (last?.version ?? 0) + 1,
        rules: rules as unknown as Prisma.InputJsonValue,
        assumptions,
        source,
        status: 'draft',
        createdBy: actorId,
      },
      include: { profile: true },
    });
    return versionView(row);
  });
}

/** Черновик можно редактировать; утвержденная версия неизменяема (и в БД — триггер). */
export async function updateDraftVersion(versionId: string, input: unknown) {
  const d = obj(input);
  const current = await prisma.sizingProfileVersion.findUnique({ where: { id: versionId } });
  if (!current) throw new SizingError('Версия профиля не найдена', 404);
  if (current.status !== 'draft')
    throw new SizingError('Утвержденная версия неизменяема. Создайте новую версию.', 409);
  const data: Prisma.SizingProfileVersionUpdateInput = {};
  if (d.rules !== undefined) data.rules = parseRules(d.rules) as unknown as Prisma.InputJsonValue;
  if (d.assumptions !== undefined) data.assumptions = assumptionsList(d.assumptions);
  if (d.source !== undefined) data.source = str(d.source, 'Источник правил', 2000);
  const updated = await prisma.sizingProfileVersion.updateMany({
    where: { id: versionId, status: 'draft' },
    data: data as Prisma.SizingProfileVersionUpdateManyMutationInput,
  });
  if (!updated.count) throw new SizingError('Версия уже утверждена', 409);
  return loadVersion(versionId);
}

export async function approveVersion(versionId: string, actorId: string) {
  const current = await prisma.sizingProfileVersion.findUnique({ where: { id: versionId } });
  if (!current) throw new SizingError('Версия профиля не найдена', 404);
  // Утверждаются только корректные правила.
  parseRules(current.rules);
  const updated = await prisma.sizingProfileVersion.updateMany({
    where: { id: versionId, status: 'draft' },
    data: { status: 'approved', approvedBy: actorId, approvedAt: new Date() },
  });
  if (!updated.count) throw new SizingError('Утвердить можно только черновик', 409);
  return loadVersion(versionId);
}

export async function archiveVersion(versionId: string) {
  const current = await prisma.sizingProfileVersion.findUnique({ where: { id: versionId } });
  if (!current) throw new SizingError('Версия профиля не найдена', 404);
  if (current.status === 'archived') return loadVersion(versionId);
  await prisma.sizingProfileVersion.update({
    where: { id: versionId },
    data: { status: 'archived' },
  });
  return loadVersion(versionId);
}

const RUN_INCLUDE = { profileVersion: { include: { profile: true } } } as const;

export async function listRuns(calculationId: string): Promise<SizingRunView[]> {
  const rows = await prisma.sizingRun.findMany({
    where: { calculationId },
    orderBy: { createdAt: 'desc' },
    include: RUN_INCLUDE,
    take: 100,
  });
  return rows.map(runView);
}

export async function loadRun(calculationId: string, runId: string): Promise<SizingRunView> {
  const row = await prisma.sizingRun.findFirst({
    where: { id: runId, calculationId },
    include: RUN_INCLUDE,
  });
  if (!row) throw new SizingError('Прогон сайзинга не найден', 404);
  return runView(row);
}

export function parseRunInputs(value: unknown): Record<string, unknown> {
  const d = value === undefined ? {} : obj(value, 'Входные параметры');
  const keys = Object.keys(d);
  if (keys.length > 200) throw new SizingError('Не более 200 входных параметров');
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = d[k];
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(k)) throw new SizingError(`Некорректный ключ входа ${k}`);
    if (
      v !== null &&
      typeof v !== 'number' &&
      typeof v !== 'boolean' &&
      !(typeof v === 'string' && v.length <= 200)
    )
      throw new SizingError(`Вход ${k}: число, логическое значение или строка`);
    if (typeof v === 'number' && !Number.isFinite(v)) throw new SizingError(`Вход ${k}: число`);
    out[k] = v;
  }
  return out;
}

/** Расчет без сохранения (предпросмотр, в т.ч. по черновой версии профиля). */
export async function evaluateVersion(versionId: string, rawInputs: unknown) {
  const version = await loadVersion(versionId);
  const inputs = parseRunInputs(rawInputs);
  return { version, inputs, evaluation: evaluateRules(parseRules(version.rules), inputs) };
}

async function requireCalculation(calculationId: string) {
  const found = await prisma.calculation.findUnique({
    where: { id: calculationId },
    select: { id: true },
  });
  if (!found) throw new SizingError('Расчет не найден', 404);
}

/** Прогон закрепляет утвержденную версию профиля и сохраняет рассчитанные результаты. */
export async function createProfileRun(
  calculationId: string,
  input: unknown,
  actorId: string,
): Promise<SizingRunView> {
  const d = obj(input);
  await requireCalculation(calculationId);
  const versionId = str(d.profileVersionId, 'Версия профиля', 100);
  const { version, inputs, evaluation } = await evaluateVersion(versionId, d.inputs);
  if (version.status !== 'approved')
    throw new SizingError('Прогон сохраняется только по утвержденной версии профиля', 409);
  const outputs = Object.fromEntries(evaluation.scenarios.map((s) => [s.key, s.outputs]));
  const scenarios = evaluation.scenarios.map(({ outputs: _o, ...rest }) => rest);
  const row = await prisma.sizingRun.create({
    data: {
      calculationId,
      profileVersionId: version.id,
      source: 'profile',
      inputs: inputs as Prisma.InputJsonValue,
      scenarios: scenarios as unknown as Prisma.InputJsonValue,
      outputs: outputs as unknown as Prisma.InputJsonValue,
      note: d.note === undefined ? '' : str(d.note, 'Комментарий', 2000, false),
      createdBy: actorId,
    },
    include: RUN_INCLUDE,
  });
  return runView(row);
}

/** Ручной сайзинг: пользователь вводит метрики сам; хранится тем же прогоном. */
export async function createManualRun(
  calculationId: string,
  input: unknown,
  actorId: string,
): Promise<SizingRunView> {
  const d = obj(input);
  await requireCalculation(calculationId);
  if (!Array.isArray(d.outputs) || !d.outputs.length || d.outputs.length > 100)
    throw new SizingError('Ручной сайзинг: от 1 до 100 метрик');
  const keys = new Set<string>();
  const outputs: SizingOutputValue[] = d.outputs.map((raw) => {
    const r = obj(raw, 'Метрика');
    const key = str(r.key, 'Ключ метрики', 64);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || keys.has(key))
      throw new SizingError(`Ключ метрики ${key}: уникальный, латиница в нижнем регистре`);
    keys.add(key);
    if (!(SIZING_METRIC_KINDS as readonly unknown[]).includes(r.kind))
      throw new SizingError(`Метрика ${key}: некорректный тип`);
    if (
      r.value !== null &&
      (typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < 0)
    )
      throw new SizingError(`Метрика ${key}: неотрицательное число или null (неизвестно)`);
    return {
      key,
      label: str(r.label, `Название ${key}`),
      kind: r.kind as SizingOutputValue['kind'],
      unit: r.unit === undefined ? '' : str(r.unit, 'Единица', 50, false),
      value: r.value as number | null,
      missing: [],
      assumptions: [],
      basis: r.basis === undefined ? 'ручная оценка' : str(r.basis, 'Основание', 500, false),
    };
  });
  const note = str(d.note, 'Основание ручного сайзинга', 2000);
  const row = await prisma.sizingRun.create({
    data: {
      calculationId,
      profileVersionId: null,
      source: 'manual',
      inputs: {},
      scenarios: [{ key: 'base', label: 'Ручная оценка', inputs: [], warnings: [] }],
      outputs: { base: outputs } as unknown as Prisma.InputJsonValue,
      note,
      createdBy: actorId,
    },
    include: RUN_INCLUDE,
  });
  return runView(row);
}
