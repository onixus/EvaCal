export function isTzAuthorEnabled(): boolean {
  const raw = process.env.EVACAL_LLM_TZ_AUTHOR;
  return raw === '1' || raw?.toLowerCase() === 'true';
}
