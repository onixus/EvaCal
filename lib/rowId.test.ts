import { afterEach, describe, expect, it, vi } from 'vitest';
import { newRowId } from './rowId';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newRowId', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses crypto.randomUUID when available', () => {
    expect(newRowId()).toMatch(UUID);
  });
  it('falls back to getRandomValues outside a secure context', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 50 }, newRowId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});
