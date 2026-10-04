/** PostgreSQL is the only database. Never fall back to an implicit local database.
 * Keep the original connection parameters and never include credentials in errors.
 */
export function resolveDatabaseUrl(raw: string | undefined = process.env.DATABASE_URL): string {
  const value = raw?.trim();
  if (!value) throw new Error('DATABASE_URL не задан: укажите URL PostgreSQL.');
  const invalid = () =>
    new Error(
      'Некорректный DATABASE_URL: требуется postgresql:// или postgres:// с адресом сервера и именем базы.',
    );
  if (!/^(postgresql|postgres):\/\//.test(value)) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  // A Unix-domain socket can be supplied via ?host=/path/to/socket.
  if ((!url.hostname && !url.searchParams.get('host')) || url.pathname.length <= 1 || url.hash) {
    throw invalid();
  }
  return value;
}
