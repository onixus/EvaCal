/** PostgreSQL substring search, case-insensitive (ILIKE), independent of env. */
export function containsInsensitive(search: string): { contains: string; mode: 'insensitive' } {
  return { contains: search, mode: 'insensitive' };
}
