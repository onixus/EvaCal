import { loadSpecification, saveSpecification } from '../specification/store';
import { isDecimal } from '../specification/validation';
import { SizingError } from './engine';
import { applySizingSelections, buildSizingImpact, type SizingImpactRun } from './impact';
import { findMetric, metricDecimal } from './refs';
import { evaluateVersion, loadRun } from './store';
import type { SizingRunView } from './types';
import { proposeCatalogCandidates } from './candidates';
import { loadCatalog } from '../catalog/store';
import { businessDate } from '../catalog/business-date';
import type { Product } from '../catalog/types';

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SizingError('Требуется объект');
  return value as Record<string, unknown>;
}
function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100)
    throw new SizingError(`Некорректное поле: ${what}`);
  return value.trim();
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new SizingError('Требуется текущая редакция спецификации');
  return Number(value);
}

export function runLabel(run: SizingRunView): string {
  const when = run.createdAt.slice(0, 16).replace('T', ' ');
  return run.profile
    ? `${run.profile.name} v${run.profile.version}, прогон ${when}`
    : `ручная оценка ${when}`;
}
function impactRun(run: SizingRunView): SizingImpactRun {
  return { id: run.id, source: run.source, label: runLabel(run), outputs: run.outputs };
}

function parseSelections(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500)
    throw new SizingError('Некорректный выбор строк');
  const seen = new Set<string>();
  return value.map((raw) => {
    const r = obj(raw);
    const itemId = id(r.itemId, 'Строка');
    if (seen.has(itemId)) throw new SizingError('Строки выбора повторяются');
    seen.add(itemId);
    if (r.allowManualOverride !== undefined && typeof r.allowManualOverride !== 'boolean')
      throw new SizingError('allowManualOverride: логическое значение');
    return { itemId, ...(r.allowManualOverride ? { allowManualOverride: true } : {}) };
  });
}

/**
 * Предпросмотр влияния: сохраненный прогон (runId) или расчет «на лету» по версии
 * профиля и входам (profileVersionId + inputs) — в т.ч. по черновику профиля,
 * если allowDraft. Сравнение — с потребностями, зафиксированными в последней
 * редакции спецификации (связанные прогоны).
 */
export async function previewSizingImpact(
  calculationId: string,
  input: unknown,
  options: { allowDraft: boolean },
) {
  const d = obj(input);
  const saved = await loadSpecification(calculationId);
  // Без спецификации предпросмотр показывает только метрики (все не покрыты позициями).
  const snapshot = saved?.snapshot ?? {
    version: 0,
    status: 'draft' as const,
    emptySupplyReason: '',
    items: [],
  };
  let run: SizingImpactRun;
  if (d.runId !== undefined) {
    run = impactRun(await loadRun(calculationId, id(d.runId, 'Прогон')));
  } else {
    const { version: v, evaluation } = await evaluateVersion(
      id(d.profileVersionId, 'Версия профиля'),
      d.inputs,
    );
    if (v.status === 'archived' || (v.status === 'draft' && !options.allowDraft))
      throw new SizingError('Предпросмотр по черновику доступен архитектору и администратору', 403);
    run = {
      id: null,
      source: 'profile',
      label: `${v.profileName} v${v.version}${v.status === 'draft' ? ' (черновик)' : ''}, без сохранения`,
      outputs: Object.fromEntries(evaluation.scenarios.map((s) => [s.key, s.outputs])),
    };
  }
  return buildSizingImpact(snapshot, run, parseSelections(d.selections));
}

/** Применение создает новую черновую редакцию спецификации обычным путем сохранения. */
export async function applySizingImpact(calculationId: string, input: unknown, actorId: string) {
  const d = obj(input);
  const expected = version(d.version);
  const selections = parseSelections(d.selections) ?? [];
  if (!selections.length) throw new SizingError('Выберите строки для применения');
  const saved = await loadSpecification(calculationId);
  if (!saved) throw new SizingError('Сначала сохраните спецификацию', 409);
  if (saved.snapshot.version !== expected)
    throw new SizingError('Спецификация изменена. Обновите предпросмотр.', 409);
  const run = impactRun(await loadRun(calculationId, id(d.runId, 'Прогон')));
  const preview = buildSizingImpact(saved.snapshot, run, selections);
  for (const s of selections) {
    const row = preview.rows.find((r) => r.itemId === s.itemId);
    if (!row) throw new SizingError('Строка не найдена в спецификации', 409);
    if (row.status === 'unknown' || row.status === 'unlinked')
      throw new SizingError(
        `${row.name}: невозможно проверить соответствие, применение запрещено`,
        409,
      );
    if (row.manualQuantity && !s.allowManualOverride)
      throw new SizingError(
        `${row.name}: количество задано вручную, требуется явное согласие`,
        409,
      );
  }
  const next = applySizingSelections(saved.snapshot, preview.rows, selections, run);
  return saveSpecification(calculationId, next, actorId);
}

/**
 * Связь строки с метрикой прогона (или снятие связи). Количество не меняется:
 * дефицит/избыток показывает предпросмотр влияния. Создает новую черновую редакцию.
 */
export async function linkSizing(calculationId: string, input: unknown, actorId: string) {
  const d = obj(input);
  const expected = version(d.version);
  const itemId = id(d.itemId, 'Строка');
  const saved = await loadSpecification(calculationId);
  if (!saved) throw new SizingError('Сначала сохраните спецификацию', 409);
  if (saved.snapshot.version !== expected)
    throw new SizingError('Спецификация изменена. Обновите данные.', 409);
  const item = saved.snapshot.items.find((i) => i.id === itemId);
  if (!item) throw new SizingError('Строка не найдена', 404);
  let next;
  if (d.runId === null) {
    if (!item.sizingRef) throw new SizingError('Строка не связана с сайзингом', 409);
    const { sizingRef: _ref, ...rest } = item;
    next = {
      ...saved.snapshot,
      status: 'draft' as const,
      items: saved.snapshot.items.map((i) =>
        i.id === itemId ? { ...rest, changeReason: 'Связь с сайзингом снята.' } : i,
      ),
    };
  } else {
    const run = await loadRun(calculationId, id(d.runId, 'Прогон'));
    const metric = typeof d.metric === 'string' ? d.metric : '';
    const scenario = d.scenario === undefined ? 'base' : String(d.scenario);
    const unitCapacity = d.unitCapacity === undefined ? '1' : d.unitCapacity;
    if (!isDecimal(unitCapacity) || Number(unitCapacity) <= 0)
      throw new SizingError('Ёмкость единицы позиции: положительное десятичное число');
    const output = findMetric(run.outputs, scenario, metric);
    if (!output) throw new SizingError('Метрика или сценарий не найдены в прогоне', 409);
    const required = metricDecimal(output.value);
    if (required === null)
      throw new SizingError(
        `Метрика «${output.label}» не рассчитана (не хватает входных данных): связь невозможна`,
        409,
      );
    next = {
      ...saved.snapshot,
      status: 'draft' as const,
      items: saved.snapshot.items.map((i) =>
        i.id === itemId
          ? {
              ...i,
              sizingRef: {
                runId: run.id,
                metric,
                ...(scenario === 'base' ? {} : { scenario }),
                requiredQuantity: required,
                ...(unitCapacity === '1' ? {} : { unitCapacity }),
              },
              changeReason: `Связано с сайзингом: ${output.label} = ${required} ${output.unit} (${runLabel(run)}).`,
            }
          : i,
      ),
    };
  }
  return saveSpecification(calculationId, next, actorId);
}

/**
 * #101 §5: кандидаты каталога для метрики сохраненного прогона ({ runId, metric,
 * scenario? }). Только предложение: спецификация не меняется, выбор кандидата
 * сохраняется пользователем обычным путем как новая черновая редакция.
 */
export async function proposeSizingCandidates(calculationId: string, input: unknown) {
  const d = obj(input);
  const run = await loadRun(calculationId, id(d.runId, 'Прогон'));
  const metric = id(d.metric, 'Метрика');
  const scenario = d.scenario === undefined ? 'base' : id(d.scenario, 'Сценарий');
  const output = findMetric(run.outputs, scenario, metric);
  if (!output) throw new SizingError('Метрика или сценарий не найдены в прогоне', 404);
  const required = metricDecimal(output.value);
  if (required === null)
    throw new SizingError(
      `Метрика «${output.label}» не рассчитана (не хватает входных данных): подбор невозможен`,
      409,
    );
  const catalog = await loadCatalog();
  const proposal = proposeCatalogCandidates({
    products: catalog.products as unknown as Product[],
    definitions: catalog.attributeDefinitions,
    metric: { key: output.key, label: output.label, unit: output.unit, required, scenario },
    run: { id: run.id, label: runLabel(run) },
    today: businessDate(new Date()) ?? new Date().toISOString().slice(0, 10),
  });
  const saved = await loadSpecification(calculationId);
  return {
    ...proposal,
    run: { id: run.id, label: runLabel(run) },
    specificationVersion: saved?.snapshot.version ?? 0,
  };
}
