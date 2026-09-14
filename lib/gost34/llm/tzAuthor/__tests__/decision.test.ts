import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/gost34/draft-tz/decision/route';
import * as flagModule from '@/lib/gost34/llm/tzAuthor/flag';
import * as authModule from '@/lib/auth';
import * as accessModule from '@/lib/access';
import * as exportModule from '@/lib/export';
import * as auditModule from '@/lib/audit';

vi.mock('@/lib/auth', () => ({
  requireApiRole: vi.fn(),
}));

vi.mock('@/lib/access', () => ({
  requireCalcAccess: vi.fn(),
}));

vi.mock('@/lib/export', () => ({
  loadCalculationForExport: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(() => '127.0.0.1'),
  redactLlmMeta: vi.fn((meta) => meta),
}));

const SAMPLE_CALCULATION = {
  id: 'calc-123',
  name: 'АС Тестирования',
  customer: 'Заказчик',
  answers: {
    personalData: false,
    securitySignificant: false,
    criticalInfra: false,
  },
  stages: [],
  risks: [],
};

describe('POST /api/gost34/draft-tz/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(flagModule, 'isTzAuthorEnabled').mockReturnValue(true);
    vi.mocked(authModule.requireApiRole).mockResolvedValue({
      userId: 'u1',
      username: 'architect',
      role: 'admin',
      exp: Date.now() + 10000,
    });
    vi.mocked(accessModule.requireCalcAccess).mockResolvedValue({
      kind: 'staff',
      actorId: 'architect',
    } as any);
    vi.mocked(exportModule.loadCalculationForExport).mockResolvedValue(SAMPLE_CALCULATION as any);
  });

  it('returns 403 when feature flag is disabled', async () => {
    vi.spyOn(flagModule, 'isTzAuthorEnabled').mockReturnValue(false);

    const req = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({
        calculationId: 'calc-123',
        nodeId: 'tz2020-general',
        decision: 'reject',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('feature_disabled');
  });

  it('returns 400 for missing or invalid parameters', async () => {
    // Missing nodeId
    const req1 = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({ calculationId: 'calc-123', decision: 'reject' }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(400);

    // Invalid decision
    const req2 = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({
        calculationId: 'calc-123',
        nodeId: 'tz2020-general',
        decision: 'invalid',
      }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(400);

    // Missing paragraphs on accept
    const req3 = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({
        calculationId: 'calc-123',
        nodeId: 'tz2020-general',
        decision: 'accept',
      }),
    });
    const res3 = await POST(req3);
    expect(res3.status).toBe(400);
  });

  it('handles reject decision: returns REJECTED proposal and logs audit', async () => {
    const req = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({
        calculationId: 'calc-123',
        nodeId: 'tz2020-general',
        decision: 'reject',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposal.status).toBe('REJECTED');
    expect(data.proposal.nodeId).toBe('tz2020-general');

    expect(auditModule.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gost34.tz_author.reject',
        entityId: 'calc-123',
        meta: expect.objectContaining({
          nodeId: 'tz2020-general',
          decision: 'reject',
        }),
      }),
    );
  });

  it('handles accept decision with clean text: returns ACCEPTED proposal and logs audit', async () => {
    const req = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({
        calculationId: 'calc-123',
        nodeId: 'tz2020-general',
        decision: 'accept',
        paragraphs: ['Настоящее техническое задание определяет требования к системе.'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposal.status).toBe('ACCEPTED');
    expect(data.proposal.paragraphs).toEqual([
      'Настоящее техническое задание определяет требования к системе.',
    ]);

    expect(auditModule.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gost34.tz_author.accept',
        entityId: 'calc-123',
        meta: expect.objectContaining({
          nodeId: 'tz2020-general',
          decision: 'accept',
          status: 'ACCEPTED',
        }),
      }),
    );
  });

  it('handles accept_edited decision: returns ACCEPTED_EDITED proposal', async () => {
    const req = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({
        calculationId: 'calc-123',
        nodeId: 'tz2020-general',
        decision: 'accept_edited',
        paragraphs: ['Отредактированный текст архитектором.'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposal.status).toBe('ACCEPTED_EDITED');
    expect(data.proposal.paragraphs).toEqual(['Отредактированный текст архитектором.']);
  });

  it('rejects accept decision with hard flags: returns 409 and does not log accept audit', async () => {
    const req = new NextRequest('http://localhost/api/gost34/draft-tz/decision', {
      method: 'POST',
      body: JSON.stringify({
        calculationId: 'calc-123',
        nodeId: 'tz2020-general',
        decision: 'accept',
        paragraphs: ['Система должна соответствовать Приказу ФСТЭК России № 21.'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('tz_author_hard_flags');
    expect(data.nodes).toEqual([
      {
        nodeId: 'tz2020-general',
        flagCodes: ['LLM_INVENTED_NORM'],
      },
    ]);

    expect(auditModule.writeAudit).not.toHaveBeenCalled();
  });
});
