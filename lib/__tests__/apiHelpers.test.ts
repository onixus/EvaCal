import { describe, it, expect } from 'vitest';
import { handleApiError, apiSuccess } from '../apiHelpers';

describe('apiHelpers', () => {
  describe('handleApiError', () => {
    it('creates a NextResponse with Error message and status', async () => {
      const err = new Error('Custom failure message');
      const response = handleApiError(err, 'Fallback', 400);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: 'Custom failure message' });
    });

    it('falls back to default status 500', async () => {
      const response = handleApiError('String error');
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({ error: 'String error' });
    });

    it('uses fallback message when error is empty', async () => {
      const response = handleApiError('', 'Fallback message', 500);
      const data = await response.json();
      expect(data).toEqual({ error: 'Fallback message' });
    });
  });

  describe('apiSuccess', () => {
    it('creates a success NextResponse with data', async () => {
      const response = apiSuccess({ ok: true, id: '123' }, 201);
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toEqual({ ok: true, id: '123' });
    });
  });
});
