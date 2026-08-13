import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  pageArgs,
  paginationHeaders,
  parseLimit,
  parsePage,
  totalPages,
} from '../pagination';

describe('parsePage', () => {
  it('accepts a positive page number', () => {
    expect(parsePage('3')).toBe(3);
  });

  it('falls back to page 1 for missing, junk or out-of-range input', () => {
    // These all arrive straight from the query string, so none may throw or
    // produce a negative `skip`.
    for (const raw of [undefined, '', 'abc', '0', '-5', '1.9e3abc', 'NaN']) {
      expect(parsePage(raw)).toBeGreaterThanOrEqual(1);
    }
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-5')).toBe(1);
  });

  it('takes the first value when the param is repeated', () => {
    expect(parsePage(['2', '7'])).toBe(2);
  });
});

describe('parseLimit', () => {
  it('defaults to the page size and clamps to the maximum', () => {
    expect(parseLimit(null)).toBe(PAGE_SIZE);
    expect(parseLimit('abc')).toBe(PAGE_SIZE);
    expect(parseLimit('0')).toBe(PAGE_SIZE);
    expect(parseLimit('10')).toBe(10);
    // A caller must not be able to ask for the whole table.
    expect(parseLimit('100000')).toBe(MAX_PAGE_SIZE);
  });
});

describe('pageArgs', () => {
  it('never produces a negative skip', () => {
    expect(pageArgs(1)).toEqual({ skip: 0, take: PAGE_SIZE });
    expect(pageArgs(3, 10)).toEqual({ skip: 20, take: 10 });
    expect(pageArgs(parsePage('-1'))).toEqual({ skip: 0, take: PAGE_SIZE });
  });
});

describe('totalPages', () => {
  it('is at least one page even when empty', () => {
    expect(totalPages(0, 50)).toBe(1);
    expect(totalPages(50, 50)).toBe(1);
    expect(totalPages(51, 50)).toBe(2);
  });
});

describe('paginationHeaders', () => {
  it('reports the total so a capped response is never silent', () => {
    expect(paginationHeaders(120, 2, 50)).toEqual({
      'X-Total-Count': '120',
      'X-Page': '2',
      'X-Page-Size': '50',
      'X-Total-Pages': '3',
    });
  });
});
