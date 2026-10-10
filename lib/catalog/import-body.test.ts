import { describe, it, expect } from 'vitest';
import { importFormData } from './import-body';
import { MAX_IMPORT_BYTES } from './import-parser';

describe('GPL multipart byte limit', () => {
  it('decodes an ordinary upload without a declared length', async () => {
    const form = new FormData();
    form.set('file', new File(['SKU;Цена\nA;0'], 'price.csv'));
    form.set('profile', '{}');
    const parsed = await importFormData(
      new Request('http://localhost/import', { method: 'POST', body: form }),
    );
    expect(await (parsed.get('file') as File).text()).toBe('SKU;Цена\nA;0');
    expect(parsed.get('profile')).toBe('{}');
  });
  it('cancels a chunked upload that exceeds the actual byte cap', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES));
        controller.enqueue(new Uint8Array(65537));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request('http://localhost/import', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);
    await expect(importFormData(req)).rejects.toMatchObject({ statusCode: 413 });
    expect(cancelled).toBe(true);
  });
});
