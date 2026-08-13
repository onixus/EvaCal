import { describe, it, expect } from 'vitest';
import { safeJsonParse, safeJsonStringify } from '../json';

describe('safeJsonParse', () => {
  it('parses valid JSON string', () => {
    const result = safeJsonParse('{"key": "value", "num": 42}', {});
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('returns fallback on invalid JSON', () => {
    const fallback = { fallback: true };
    const result = safeJsonParse('invalid-json{', fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback on null, undefined or empty string', () => {
    expect(safeJsonParse(null, { default: 1 })).toEqual({ default: 1 });
    expect(safeJsonParse(undefined, [1, 2])).toEqual([1, 2]);
    expect(safeJsonParse('', 'default')).toEqual('default');
  });

  it('parses primitive numbers, booleans, and arrays safely', () => {
    expect(safeJsonParse('123', 0)).toBe(123);
    expect(safeJsonParse('true', false)).toBe(true);
    expect(safeJsonParse('[1, 2, 3]', [])).toEqual([1, 2, 3]);
  });
});

describe('safeJsonStringify', () => {
  it('serializes objects to JSON string', () => {
    expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
  });

  it('handles circular references with fallback', () => {
    const obj: any = {};
    obj.self = obj;
    expect(safeJsonStringify(obj, '{}')).toBe('{}');
  });
});
