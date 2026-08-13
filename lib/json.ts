/**
 * Safe JSON parsing and serialization utilities with TypeScript generics.
 */

/**
 * Safely parse a JSON string with a typed fallback value on failure.
 */
export function safeJsonParse<T>(input: string | null | undefined, fallback: T): T {
  if (!input || typeof input !== 'string') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(input);
    return parsed !== null && parsed !== undefined ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Safely serialize an object to JSON string with an optional fallback.
 */
export function safeJsonStringify(input: unknown, fallback = '{}'): string {
  try {
    return JSON.stringify(input);
  } catch {
    return fallback;
  }
}
