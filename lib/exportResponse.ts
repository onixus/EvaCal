export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}\- _]/gu, '').trim() || 'calculation';
}

/**
 * Wraps a generated document Buffer as a response body without copying it.
 * `new Uint8Array(buf)` duplicates the bytes; a view over the same memory does not,
 * which matters for multi-megabyte docx/xlsx/zip exports.
 */
export function responseBody(buffer: Buffer): Uint8Array<ArrayBuffer> {
  // Node always backs a Buffer with a plain ArrayBuffer here; the cast just drops
  // the SharedArrayBuffer half of ArrayBufferLike so this satisfies BodyInit.
  return new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
}

export function contentDisposition(safeName: string, extension: string): string {
  return `attachment; filename="calculation.${extension}"; filename*=UTF-8''${encodeURIComponent(
    safeName,
  )}.${extension}`;
}

