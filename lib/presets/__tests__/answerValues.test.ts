import { describe, expect, it } from 'vitest';
import { parseAnswerBoolean, parseAnswerNumber } from '../answerValues';

describe('parseAnswerNumber', () => {
  it.each([
    [10, 10],
    [0, 0],
    ['10 Гбит/с', 10],
    ['2,5', 2.5],
    ['1.75', 1.75],
    ['-3', -3],
    ['10 000', 10000],
    ['10 000', 10000],
    ['1 234 567', 1234567],
    ['1 234 567,5 EPS', 1234567.5],
    ['около 50 000 идентичностей', 50000],
    // A group that is not exactly three digits is not a thousands separator.
    ['2 3', 2],
    ['10 00', 10],
  ])('%j → %j', (input, expected) => {
    expect(parseAnswerNumber(input)).toBe(expected);
  });
  it('missing or non-numeric answers stay undefined (not 0)', () => {
    for (const value of [undefined, null, '', 'нет данных', Number.NaN, Infinity, {}])
      expect(parseAnswerNumber(value)).toBeUndefined();
  });
});

describe('parseAnswerBoolean', () => {
  it('keeps explicit false and unknown apart', () => {
    expect(parseAnswerBoolean('нет')).toBe(false);
    expect(parseAnswerBoolean(0)).toBe(false);
    expect(parseAnswerBoolean('да')).toBe(true);
    expect(parseAnswerBoolean('возможно')).toBeUndefined();
  });
});
