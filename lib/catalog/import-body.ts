import { SpecificationError } from '../specification/validation';
import { MAX_IMPORT_BYTES } from './import-parser';

// Limit the actual stream as well as Content-Length before multipart decoding.
// Browsers and reverse proxies may send uploads without Content-Length.
export async function importFormData(req: Request): Promise<FormData> {
  const limit = MAX_IMPORT_BYTES + 65536;
  if (Number(req.headers.get('content-length')) > limit)
    throw new SpecificationError('Размер загрузки превышает 5 МБ', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new SpecificationError('Требуется файл GPL');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new SpecificationError('Размер загрузки превышает 5 МБ', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(req.url, { method: 'POST', headers: req.headers, body: bytes }).formData();
}
