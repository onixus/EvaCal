/**
 * Небольшой безопасный язык формул сайзинга (без eval/Function).
 *
 * Грамматика: числа, true/false, идентификаторы, скобки, унарные `-` и `!`,
 * `* / %`, `+ -`, сравнения `< <= > >= == !=`, `&&`, `||`, тернарный `?:` и
 * вызовы функций из белого списка (max, min, ceil, floor, round, abs, if, lookup).
 *
 * Неизвестное значение (null) распространяется по выражению: отсутствие данных
 * никогда не превращается в 0. Короткое замыкание `&&`/`||`/`?:`/`if` позволяет
 * не требовать данные ветки, которая не выбрана.
 */

export type SizingValue = number | boolean | string | null;

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string }
  | { t: 'un'; op: '-' | '!'; e: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'cond'; c: Expr; a: Expr; b: Expr }
  | { t: 'call'; fn: string; args: Expr[] };

export class SizingExpressionError extends Error {}

const FUNCTIONS = ['max', 'min', 'ceil', 'floor', 'round', 'abs', 'if', 'lookup'] as const;
const MAX_LENGTH = 2000;
const MAX_DEPTH = 64;

type Token = { k: 'num' | 'id' | 'str' | 'op'; v: string };

function tokenize(source: string): Token[] {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_LENGTH)
    throw new SizingExpressionError(`Формула пуста или длиннее ${MAX_LENGTH} символов`);
  const tokens: Token[] = [];
  const re =
    /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|'([^'\\]{0,200})'|(<=|>=|==|!=|&&|\|\||[-+*/%<>!?:(),]))/y;
  let pos = 0;
  while (pos < source.length) {
    if (/^\s*$/.test(source.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(source);
    if (!m) throw new SizingExpressionError(`Недопустимый символ в позиции ${pos + 1}`);
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) tokens.push({ k: 'id', v: m[2] });
    else if (m[3] !== undefined) tokens.push({ k: 'str', v: m[3] });
    else tokens.push({ k: 'op', v: m[4] });
  }
  return tokens;
}

const BINARY: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export function parseExpression(source: string): Expr {
  const tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i];
  const expect = (v: string) => {
    const tok = tokens[i++];
    if (!tok || tok.k !== 'op' || tok.v !== v)
      throw new SizingExpressionError(`Ожидалось «${v}» в формуле «${source}»`);
  };
  const primary = (depth: number): Expr => {
    if (depth > MAX_DEPTH) throw new SizingExpressionError('Слишком глубокая вложенность формулы');
    const tok = tokens[i++];
    if (!tok) throw new SizingExpressionError(`Неожиданный конец формулы «${source}»`);
    if (tok.k === 'num') {
      const v = Number(tok.v);
      if (!Number.isFinite(v)) throw new SizingExpressionError('Некорректное число');
      return { t: 'num', v };
    }
    if (tok.k === 'str') return { t: 'str', v: tok.v };
    if (tok.k === 'id') {
      if (tok.v === 'true' || tok.v === 'false') return { t: 'bool', v: tok.v === 'true' };
      const next = peek();
      if (next?.k === 'op' && next.v === '(') {
        if (!(FUNCTIONS as readonly string[]).includes(tok.v))
          throw new SizingExpressionError(`Неизвестная функция «${tok.v}»`);
        i++;
        const args: Expr[] = [];
        if (!(peek()?.k === 'op' && peek()?.v === ')')) {
          for (;;) {
            args.push(expression(depth + 1));
            if (peek()?.k === 'op' && peek()?.v === ',') {
              i++;
              continue;
            }
            break;
          }
        }
        expect(')');
        return { t: 'call', fn: tok.v, args };
      }
      return { t: 'id', name: tok.v };
    }
    if (tok.v === '(') {
      const e = expression(depth + 1);
      expect(')');
      return e;
    }
    if (tok.v === '-' || tok.v === '!') return { t: 'un', op: tok.v, e: primary(depth + 1) };
    throw new SizingExpressionError(`Неожиданный символ «${tok.v}» в формуле «${source}»`);
  };
  const binary = (minPrec: number, depth: number): Expr => {
    let left = primary(depth);
    for (;;) {
      const tok = peek();
      const prec = tok?.k === 'op' ? BINARY[tok.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      i++;
      left = { t: 'bin', op: tok.v, l: left, r: binary(prec + 1, depth + 1) };
    }
  };
  const expression = (depth: number): Expr => {
    if (depth > MAX_DEPTH) throw new SizingExpressionError('Слишком глубокая вложенность формулы');
    const c = binary(1, depth);
    if (peek()?.k === 'op' && peek()?.v === '?') {
      i++;
      const a = expression(depth + 1);
      expect(':');
      return { t: 'cond', c, a, b: expression(depth + 1) };
    }
    return c;
  };
  const result = expression(0);
  if (i !== tokens.length) throw new SizingExpressionError(`Лишние символы в формуле «${source}»`);
  return result;
}

/** Идентификаторы, на которые ссылается формула (для проверки профиля). */
export function referencedNames(expr: Expr, out = new Set<string>()): Set<string> {
  switch (expr.t) {
    case 'id':
      out.add(expr.name);
      break;
    case 'un':
      referencedNames(expr.e, out);
      break;
    case 'bin':
      referencedNames(expr.l, out);
      referencedNames(expr.r, out);
      break;
    case 'cond':
      referencedNames(expr.c, out);
      referencedNames(expr.a, out);
      referencedNames(expr.b, out);
      break;
    case 'call':
      // Первый аргумент lookup — имя таблицы, а не переменная.
      expr.args.forEach((a, index) => {
        if (!(expr.fn === 'lookup' && index === 0)) referencedNames(a, out);
      });
      break;
  }
  return out;
}

export interface LookupTable {
  /** Ступенчатая таблица: первая строка, где значение ≤ upTo (null — без верхней границы). */
  rows: Array<{ upTo: number | null; value: number }>;
}

export interface EvalContext {
  /** null — значение неизвестно. undefined — имя не определено (ошибка профиля). */
  resolve(name: string): SizingValue | undefined;
  tables: Record<string, LookupTable>;
}

function num(v: SizingValue, what: string): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new SizingExpressionError(`${what}: ожидалось число`);
}
function truthy(v: SizingValue): boolean | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}

export function evaluate(expr: Expr, ctx: EvalContext): SizingValue {
  switch (expr.t) {
    case 'num':
    case 'bool':
    case 'str':
      return expr.v;
    case 'id': {
      const v = ctx.resolve(expr.name);
      if (v === undefined) throw new SizingExpressionError(`Неизвестное имя «${expr.name}»`);
      return v;
    }
    case 'un': {
      const v = evaluate(expr.e, ctx);
      if (v === null) return null;
      return expr.op === '!' ? !truthy(v) : -(num(v, 'Унарный минус') as number);
    }
    case 'cond':
    case 'call':
      if (expr.t === 'cond' || expr.fn === 'if') {
        const [c, a, b] = expr.t === 'cond' ? [expr.c, expr.a, expr.b] : expr.args;
        if (!c || !a || !b) throw new SizingExpressionError('if(условие, да, нет)');
        const cond = truthy(evaluate(c, ctx));
        if (cond === null) return null;
        return evaluate(cond ? a : b, ctx);
      }
      return call(expr.fn, expr.args, ctx);
    case 'bin': {
      if (expr.op === '&&' || expr.op === '||') {
        const l = truthy(evaluate(expr.l, ctx));
        if (expr.op === '&&' && l === false) return false;
        if (expr.op === '||' && l === true) return true;
        const r = truthy(evaluate(expr.r, ctx));
        if (expr.op === '&&' && r === false) return false;
        if (expr.op === '||' && r === true) return true;
        return l === null || r === null ? null : r;
      }
      const lv = evaluate(expr.l, ctx);
      const rv = evaluate(expr.r, ctx);
      if (lv === null || rv === null) return null;
      if (expr.op === '==' || expr.op === '!=') {
        const same = lv === rv;
        return expr.op === '==' ? same : !same;
      }
      const l = num(lv, expr.op) as number;
      const r = num(rv, expr.op) as number;
      switch (expr.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
        case '%':
          if (r === 0) throw new SizingExpressionError('Деление на ноль');
          return expr.op === '/' ? l / r : l % r;
        case '<':
          return l < r;
        case '<=':
          return l <= r;
        case '>':
          return l > r;
        case '>=':
          return l >= r;
      }
      throw new SizingExpressionError(`Неизвестная операция ${expr.op}`);
    }
  }
}

function call(fn: string, args: Expr[], ctx: EvalContext): SizingValue {
  if (fn === 'lookup') {
    const [tableExpr, keyExpr] = args;
    if (args.length !== 2 || tableExpr?.t !== 'str')
      throw new SizingExpressionError("lookup('таблица', значение)");
    // Только собственные ключи: имена вроде constructor не должны найти Object.prototype.
    const table = Object.hasOwn(ctx.tables, tableExpr.v) ? ctx.tables[tableExpr.v] : undefined;
    if (!table) throw new SizingExpressionError(`Нет таблицы «${tableExpr.v}»`);
    const key = num(evaluate(keyExpr, ctx), 'lookup');
    if (key === null) return null;
    const row = table.rows.find((r) => r.upTo === null || key <= r.upTo);
    // Значение вне таблицы — неизвестно, а не крайняя строка.
    return row ? row.value : null;
  }
  const values = args.map((a) => num(evaluate(a, ctx), fn));
  if (values.some((v) => v === null)) return null;
  const v = values as number[];
  switch (fn) {
    case 'max':
    case 'min':
      if (!v.length) throw new SizingExpressionError(`${fn}() требует аргументы`);
      return fn === 'max' ? Math.max(...v) : Math.min(...v);
    case 'ceil':
    case 'floor':
    case 'abs':
      if (v.length !== 1) throw new SizingExpressionError(`${fn}(x)`);
      return Math[fn](v[0]);
    case 'round': {
      if (v.length < 1 || v.length > 2) throw new SizingExpressionError('round(x[, знаки])');
      const factor = 10 ** (v[1] ?? 0);
      return Math.round(v[0] * factor) / factor;
    }
  }
  throw new SizingExpressionError(`Неизвестная функция «${fn}»`);
}
