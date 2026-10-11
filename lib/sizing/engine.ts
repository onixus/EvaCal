import { parseAnswerBoolean, parseAnswerNumber } from '../presets/answerValues';
import {
  evaluate,
  parseExpression,
  referencedNames,
  SizingExpressionError,
  type Expr,
  type LookupTable,
  type SizingValue,
} from './expression';
import {
  SIZING_METRIC_KINDS,
  type SizingEvaluation,
  type SizingInputDef,
  type SizingInputValue,
  type SizingOutputDef,
  type SizingOutputValue,
  type SizingRules,
  type SizingScenarioResult,
} from './types';

export class SizingError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED = new Set([
  'true',
  'false',
  'max',
  'min',
  'ceil',
  'floor',
  'round',
  'abs',
  'if',
  'lookup',
  // Имена из прототипа объекта запрещены, чтобы не разрешаться через Object.prototype.
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

/** Собственное значение ключа без обращения к прототипу. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function obj(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SizingError(`${what}: требуется объект`);
  return value as Record<string, unknown>;
}
function str(value: unknown, what: string, max = 200, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new SizingError(`${what}: строка до ${max} символов`);
  return value.trim();
}
function key(value: unknown, what: string): string {
  if (typeof value !== 'string' || !KEY.test(value) || RESERVED.has(value))
    throw new SizingError(`${what}: ключ латиницей в нижнем регистре (a-z, 0-9, _)`);
  return value;
}
function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new SizingError(`${what}: требуется число`);
  return value;
}
function array(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new SizingError(`${what}: список до ${max} элементов`);
  return value;
}

/**
 * Строгая проверка правил профиля: ключи, формулы, ссылки только на объявленные
 * имена (входы, производные и ранее объявленные выходы), отсутствие циклов.
 */
export function parseRules(input: unknown): SizingRules {
  const d = obj(input, 'Правила');
  const names = new Set<string>();
  const declare = (name: string) => {
    if (names.has(name)) throw new SizingError(`Имя «${name}» объявлено дважды`);
    names.add(name);
  };
  const tables: Record<string, LookupTable> = Object.create(null);
  for (const [name, raw] of Object.entries(
    d.tables === undefined ? {} : obj(d.tables, 'Таблицы'),
  )) {
    key(name, 'Таблица');
    const rows = array(obj(raw, `Таблица ${name}`).rows, `Строки таблицы ${name}`, 200).map((r) => {
      const row = obj(r, `Строка таблицы ${name}`);
      return {
        upTo: row.upTo === null ? null : finite(row.upTo, `Граница таблицы ${name}`),
        value: finite(row.value, `Значение таблицы ${name}`),
      };
    });
    if (!rows.length) throw new SizingError(`Таблица ${name} пуста`);
    rows.forEach((row, i) => {
      if (row.upTo === null && i !== rows.length - 1)
        throw new SizingError(`Таблица ${name}: строка без границы должна быть последней`);
      if (i > 0 && row.upTo !== null && rows[i - 1].upTo! >= row.upTo)
        throw new SizingError(`Таблица ${name}: границы должны возрастать`);
    });
    tables[name] = { rows };
  }
  const inputs: SizingInputDef[] = array(d.inputs, 'Входные параметры', 200).map((raw) => {
    const r = obj(raw, 'Вход');
    const def: SizingInputDef = {
      key: key(r.key, 'Ключ входа'),
      label: str(r.label, 'Название входа'),
      type: r.type as SizingInputDef['type'],
    };
    if (!['number', 'boolean', 'text'].includes(def.type))
      throw new SizingError(`Тип входа ${def.key}: number | boolean | text`);
    declare(def.key);
    if (r.unit !== undefined) def.unit = str(r.unit, 'Единица', 50, false);
    if (r.min !== undefined) def.min = finite(r.min, `min ${def.key}`);
    if (r.max !== undefined) def.max = finite(r.max, `max ${def.key}`);
    if (def.min !== undefined && def.max !== undefined && def.min > def.max)
      throw new SizingError(`Вход ${def.key}: min больше max`);
    if (r.default !== undefined) {
      const ok =
        (def.type === 'number' && typeof r.default === 'number' && Number.isFinite(r.default)) ||
        (def.type === 'boolean' && typeof r.default === 'boolean') ||
        (def.type === 'text' && typeof r.default === 'string' && r.default.length <= 200);
      if (!ok) throw new SizingError(`Допущение для ${def.key} не соответствует типу`);
      def.default = r.default as SizingInputDef['default'];
    }
    return def;
  });
  const checkFormula = (formula: unknown, what: string, known: Set<string>): string => {
    const source = str(formula, what, 2000);
    let expr: Expr;
    try {
      expr = parseExpression(source);
    } catch (e) {
      throw new SizingError(`${what}: ${(e as Error).message}`);
    }
    for (const name of referencedNames(expr))
      if (!known.has(name)) throw new SizingError(`${what}: неизвестное имя «${name}»`);
    collectTables(expr).forEach((t) => {
      if (!Object.hasOwn(tables, t)) throw new SizingError(`${what}: нет таблицы «${t}»`);
    });
    return source;
  };
  const inputNames = new Set(names);
  // Производные и выходы видят только объявленные выше имена: циклы невозможны.
  const derived = array(d.derived ?? [], 'Производные величины', 200).map((raw) => {
    const r = obj(raw, 'Производная');
    const k = key(r.key, 'Ключ производной');
    const formula = checkFormula(r.formula, `Формула ${k}`, new Set(names));
    declare(k);
    return { key: k, formula };
  });
  const outputs: SizingOutputDef[] = array(d.outputs, 'Метрики', 100).map((raw) => {
    const r = obj(raw, 'Метрика');
    const k = key(r.key, 'Ключ метрики');
    const formula = checkFormula(r.formula, `Формула ${k}`, new Set(names));
    declare(k);
    if (!(SIZING_METRIC_KINDS as readonly unknown[]).includes(r.kind))
      throw new SizingError(`Метрика ${k}: тип из ${SIZING_METRIC_KINDS.join(', ')}`);
    const out: SizingOutputDef = {
      key: k,
      label: str(r.label, `Название ${k}`),
      kind: r.kind as SizingOutputDef['kind'],
      unit: str(r.unit, `Единица ${k}`, 50, false),
      formula,
    };
    if (r.round !== undefined) {
      if (
        r.round !== 'ceil' &&
        r.round !== 'floor' &&
        !(Number.isInteger(r.round) && Number(r.round) >= 0 && Number(r.round) <= 6)
      )
        throw new SizingError(`Метрика ${k}: round — ceil | floor | 0..6`);
      out.round = r.round as SizingOutputDef['round'];
    }
    if (r.basis !== undefined) out.basis = str(r.basis, `Основание ${k}`, 500, false);
    return out;
  });
  if (!outputs.length) throw new SizingError('Профиль должен объявлять хотя бы одну метрику');
  const scenarioKeys = new Set<string>();
  const scenarios = array(d.scenarios ?? [], 'Сценарии', 20).map((raw) => {
    const r = obj(raw, 'Сценарий');
    const k = key(r.key, 'Ключ сценария');
    if (k === 'base' || scenarioKeys.has(k))
      throw new SizingError(`Сценарий «${k}» зарезервирован или повторяется`);
    scenarioKeys.add(k);
    const overrides: Record<string, string> = {};
    for (const [target, formula] of Object.entries(obj(r.overrides, `Сценарий ${k}`))) {
      if (!inputNames.has(target))
        throw new SizingError(`Сценарий ${k}: переопределять можно только входы (${target})`);
      overrides[target] = checkFormula(formula, `Сценарий ${k}.${target}`, inputNames);
    }
    return { key: k, label: str(r.label, `Название сценария ${k}`), overrides };
  });
  return { inputs, derived, outputs, scenarios, tables };
}

function collectTables(expr: Expr, out: string[] = []): string[] {
  if (expr.t === 'call') {
    if (expr.fn === 'lookup' && expr.args[0]?.t === 'str') out.push(expr.args[0].v);
    expr.args.forEach((a) => collectTables(a, out));
  } else if (expr.t === 'un') collectTables(expr.e, out);
  else if (expr.t === 'bin') {
    collectTables(expr.l, out);
    collectTables(expr.r, out);
  } else if (expr.t === 'cond') [expr.c, expr.a, expr.b].forEach((e) => collectTables(e, out));
  return out;
}

/** Разбор пользовательского значения: undefined — значения нет (не 0 и не false). */
function readInput(def: SizingInputDef, raw: unknown): number | boolean | string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (def.type === 'number') return parseAnswerNumber(raw);
  if (def.type === 'boolean') return parseAnswerBoolean(raw);
  const text = String(raw).trim();
  return text ? text.slice(0, 200) : undefined;
}

function rounded(value: number, mode: SizingOutputDef['round']): number {
  if (mode === 'ceil') return Math.ceil(value - 1e-9);
  if (mode === 'floor') return Math.floor(value + 1e-9);
  if (typeof mode === 'number') {
    const f = 10 ** mode;
    return Math.round(value * f) / f;
  }
  return value;
}

/**
 * Кэш разобранных формул. Правила версии профиля неизменяемы после утверждения,
 * а текст формулы однозначно задает AST, поэтому кэш по тексту безопасен для всех версий.
 */
const AST_CACHE = new Map<string, Expr>();
const AST_CACHE_LIMIT = 5000;
export function compiled(formula: string): Expr {
  let expr = AST_CACHE.get(formula);
  if (!expr) {
    expr = parseExpression(formula);
    if (AST_CACHE.size >= AST_CACHE_LIMIT) AST_CACHE.delete(AST_CACHE.keys().next().value!);
    AST_CACHE.set(formula, expr);
  }
  return expr;
}

/** Бесконечность/NaN не выдаются за результат: значение неизвестно, причина — в предупреждении. */
function finiteOrWarn(name: string, value: SizingValue, warnings: string[]): SizingValue {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    warnings.push(
      `${name}: результат не является конечным числом (${String(value)}, вероятно переполнение); значение не определено.`,
    );
    return null;
  }
  return value;
}

interface ResolvedInput extends SizingInputValue {
  deps: Set<string>;
}

function scenario(
  rules: SizingRules,
  key: string,
  label: string,
  inputs: Map<string, ResolvedInput>,
  warnings: string[],
  origins: Map<string, SizingInputValue['origin']>,
): SizingScenarioResult {
  // Значения и множество входов, от которых зависит каждое имя.
  const values = new Map<string, { value: SizingValue; deps: Set<string> }>();
  for (const [k, input] of inputs) values.set(k, { value: input.value, deps: input.deps });
  const calc = (name: string, formula: string) => {
    const deps = new Set<string>();
    const ctx = {
      tables: rules.tables,
      resolve: (n: string) => {
        const v = values.get(n);
        if (!v) return undefined;
        v.deps.forEach((d) => deps.add(d));
        return v.value;
      },
    };
    let value: SizingValue;
    try {
      value = evaluate(compiled(formula), ctx);
    } catch (e) {
      if (!(e instanceof SizingExpressionError)) throw e;
      warnings.push(`${name}: ${e.message}; значение не определено.`);
      value = null;
    }
    value = finiteOrWarn(name, value, warnings);
    values.set(name, { value, deps });
    return { value, deps };
  };
  for (const d of rules.derived) calc(d.key, d.formula);
  const outputs: SizingOutputValue[] = rules.outputs.map((def) => {
    const { value, deps } = calc(def.key, def.formula);
    let numeric: number | null = null;
    if (typeof value === 'number') numeric = rounded(value, def.round);
    else if (typeof value === 'boolean') numeric = value ? 1 : 0;
    else if (value !== null) warnings.push(`${def.key}: формула вернула текст, ожидалось число.`);
    if (numeric !== null) values.set(def.key, { value: numeric, deps });
    const used = [...deps].filter((k) => origins.has(k));
    const by = (origin: string) => used.filter((k) => origins.get(k) === origin);
    return {
      key: def.key,
      label: def.label,
      kind: def.kind,
      unit: def.unit,
      value: numeric,
      missing: numeric === null ? by('missing') : [],
      assumptions: by('assumption'),
      basis: def.basis ?? '',
    };
  });
  return {
    key,
    label,
    inputs: [...inputs.values()].map(({ deps: _deps, ...rest }) => rest),
    outputs,
    warnings,
  };
}

/**
 * Рассчитывает базовый сценарий и все сценарии профиля. Входы, которых нет и для
 * которых нет допущения, остаются неизвестными: зависящие метрики = null.
 */
export function evaluateRules(
  rules: SizingRules,
  rawInputs: Record<string, unknown>,
): SizingEvaluation {
  const base = new Map<string, ResolvedInput>();
  const baseWarnings: string[] = [];
  for (const def of rules.inputs) {
    const raw = own(rawInputs, def.key);
    let value = readInput(def, raw);
    let origin: SizingInputValue['origin'] = 'answer';
    if (value === undefined && raw !== undefined && raw !== null && raw !== '')
      baseWarnings.push(`${def.label}: значение «${String(raw)}» не распознано.`);
    if (value === undefined && def.default !== undefined) {
      value = def.default;
      origin = 'assumption';
    }
    if (typeof value === 'number') {
      const clamped = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, value));
      if (clamped !== value) {
        baseWarnings.push(
          `${def.label}: значение ${value} вне допустимого диапазона, принято ${clamped}.`,
        );
        value = clamped;
      }
    }
    base.set(def.key, {
      key: def.key,
      label: def.label,
      value: value ?? null,
      origin: value === undefined ? 'missing' : origin,
      ...(def.unit ? { unit: def.unit } : {}),
      deps: new Set([def.key]),
    });
  }
  const baseOrigins = new Map([...base].map(([k, v]) => [k, v.origin]));
  const results = [scenario(rules, 'base', 'Базовый', base, baseWarnings, baseOrigins)];
  for (const s of rules.scenarios) {
    const inputs = new Map<string, ResolvedInput>();
    const warnings: string[] = [];
    const origins = new Map(baseOrigins);
    for (const [k, v] of base) inputs.set(k, { ...v, deps: new Set(v.deps) });
    for (const [target, formula] of Object.entries(s.overrides)) {
      const deps = new Set<string>();
      let value: SizingValue;
      try {
        value = evaluate(compiled(formula), {
          tables: rules.tables,
          resolve: (n) => {
            const v = base.get(n);
            if (!v) return undefined;
            v.deps.forEach((d) => deps.add(d));
            return v.value;
          },
        });
      } catch (e) {
        if (!(e instanceof SizingExpressionError)) throw e;
        warnings.push(`${target}: ${e.message}`);
        value = null;
      }
      value = finiteOrWarn(`${s.key}.${target}`, value, warnings);
      const prev = base.get(target)!;
      // Константа сценария — сценарное значение; формула наследует происхождение
      // исходных входов (для пометок «неизвестно» и «допущение»).
      if (!deps.size) origins.set(target, 'scenario');
      inputs.set(target, {
        ...prev,
        value,
        origin: value === null ? 'missing' : 'scenario',
        deps: deps.size ? deps : new Set([target]),
      });
    }
    results.push(scenario(rules, s.key, s.label, inputs, warnings, origins));
  }
  return { scenarios: results };
}
