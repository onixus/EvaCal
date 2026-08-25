import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns status ok, uptime, and timestamp', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof data.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(data.timestamp))).toBe(false);
  });
});
