import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as reviewPackage } from '@/app/api/gost34/packages/[id]/review/route';
import { GET as getPackage } from '@/app/api/gost34/packages/[id]/route';

vi.mock('@/lib/access', () => ({ requireCalcAccess: vi.fn() }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
  clientIp: vi.fn(() => '127.0.0.1'),
  actorTypeFromAccess: vi.fn(() => 'user'),
}));
vi.mock('@/lib/changelog', () => ({ recordInternalChangeSafe: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { gostPackage: { findUnique: vi.fn(), update: vi.fn() } },
}));

import { requireCalcAccess } from '@/lib/access';
import { prisma } from '@/lib/prisma';

const staff = (role: string) => ({
  kind: 'staff' as const,
  actorId: 'u1',
  session: { userId: 'u1', username: role, role, exp: 0 },
});

const shareAccess = {
  kind: 'share' as const,
  actorId: 'share:token',
  share: { calculationId: 'c1', scopes: ['review', 'read'] },
};

const pkg = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  calculationId: 'c1',
  projectId: 'prj1',
  name: 'Комплект ГОСТ 34',
  version: 1,
  status: 'under_review',
  reviewStage: 'tw',
  reviewChecklist: null,
  reviewComments: null,
  checksum: 'abc',
  documentTypes: '["tz"]',
  approvedAt: null,
  approvedBy: null,
  reviewComment: null,
  twVersionPath: null,
  twVersionName: null,
  twVersionUploadedAt: null,
  twVersionUploadedBy: null,
  twVersionIsPriority: false,
  snapshot: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const decide = (body: unknown) =>
  reviewPackage(
    new NextRequest('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'p1' }) },
  );

describe('Разделение этапов ревью комплекта', () => {
  beforeEach(() => vi.clearAllMocks());

  it('архитектор не проходит нормоконтроль за тех.писателя', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('architect') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(pkg() as never);

    const res = await decide({ decision: 'approve' });

    expect(res.status).toBe(403);
    expect(prisma.gostPackage.update).not.toHaveBeenCalled();
  });

  it('тех.писатель не ставит подпись ГАПа на этапе gap', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('reviewer') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({ reviewStage: 'gap' }) as never,
    );

    const res = await decide({ decision: 'approve' });

    expect(res.status).toBe(403);
    expect(prisma.gostPackage.update).not.toHaveBeenCalled();
  });

  it('тех.писатель проходит свой этап и передаёт комплект ГАПу', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('reviewer') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(pkg() as never);
    vi.mocked(prisma.gostPackage.update).mockResolvedValue(pkg({ reviewStage: 'gap' }) as never);

    const res = await decide({ decision: 'approve' });

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.gostPackage.update).mock.calls[0][0]).toMatchObject({
      data: { reviewStage: 'gap', status: 'under_review' },
    });
  });

  it('ГАП утверждает выпуск на своём этапе', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('architect') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({ reviewStage: 'gap' }) as never,
    );
    vi.mocked(prisma.gostPackage.update).mockResolvedValue(
      pkg({ reviewStage: 'done', status: 'approved' }) as never,
    );

    const res = await decide({ decision: 'approve', reviewerName: 'Михайлов Д.П.' });

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.gostPackage.update).mock.calls[0][0]).toMatchObject({
      data: { status: 'approved', reviewStage: 'done' },
    });
  });

  it('внешний рецензент по share-ссылке допущен к нормоконтролю, но не к подписи ГАПа', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(shareAccess as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({ reviewStage: 'gap' }) as never,
    );

    const res = await decide({ decision: 'approve' });

    expect(res.status).toBe(403);
    expect(prisma.gostPackage.update).not.toHaveBeenCalled();
  });

  it('возврат с замечаниями тоже закреплён за ролью этапа', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('architect') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(pkg() as never);

    const res = await decide({ decision: 'reject', comment: 'вернуть' });

    expect(res.status).toBe(403);
  });

  it('админ ведёт оба этапа', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('admin') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({ reviewStage: 'gap' }) as never,
    );
    vi.mocked(prisma.gostPackage.update).mockResolvedValue(
      pkg({ reviewStage: 'done', status: 'approved' }) as never,
    );

    const res = await decide({ decision: 'approve' });

    expect(res.status).toBe(200);
  });
});

describe('Отказ по правилам ревью — конфликт, а не сбой сервера', () => {
  beforeEach(() => vi.clearAllMocks());

  it('открытый блокер даёт 409', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('reviewer') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({
        reviewComments: JSON.stringify([
          {
            id: 'c1',
            sectionId: '4.4',
            severity: 'blocker',
            text: 'раздел противоречит таблице требований',
            author: 'reviewer',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]),
      }) as never,
    );

    const res = await decide({ decision: 'approve' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'Утверждение недоступно, пока открыт хотя бы один блокер.',
    });
    expect(prisma.gostPackage.update).not.toHaveBeenCalled();
  });

  it('проваленный пункт чек-листа тоже блокирует утверждение', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('reviewer') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({
        reviewChecklist: JSON.stringify([{ id: 'terminology', state: 'block', note: '' }]),
      }) as never,
    );

    const res = await decide({ decision: 'approve' });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/gost34/packages/:id отдаёт состояние ревью', () => {
  beforeEach(() => vi.clearAllMocks());

  it('возвращает этап, чек-лист, замечания и версию тех.писателя', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('reviewer') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({
        reviewStage: 'gap',
        reviewChecklist: JSON.stringify([{ id: 'terminology', state: 'ok', note: 'сверено' }]),
        reviewComments: JSON.stringify([
          {
            id: 'c1',
            sectionId: '4.3',
            severity: 'remark',
            text: 'дубли отметок',
            author: 'reviewer',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]),
        twVersionPath: 'prj1/p1-tw.docx',
        twVersionName: 'ТЗ_вычитка.docx',
        twVersionUploadedAt: new Date('2026-01-02T10:00:00Z'),
        twVersionUploadedBy: 'reviewer',
        twVersionIsPriority: true,
        calculation: {
          id: 'c1',
          name: 'Расчёт',
          customer: 'Заказчик',
          version: 1,
          status: 'approved',
        },
        project: { id: 'prj1', name: 'Проект', customer: 'Заказчик', code: null },
      }) as never,
    );

    const res = await getPackage(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: 'p1' }),
    });
    const body = await res.json();

    expect(body.package.reviewStage).toBe('gap');
    expect(body.package.reviewChecklist).toHaveLength(6);
    expect(
      body.package.reviewChecklist.find((i: { id: string }) => i.id === 'terminology'),
    ).toMatchObject({ state: 'ok' });
    expect(body.package.reviewComments).toHaveLength(1);
    expect(body.package.twVersion).toMatchObject({
      name: 'ТЗ_вычитка.docx',
      uploadedBy: 'reviewer',
      isPriority: true,
    });
  });

  it('без загруженной версии тех.писателя поле пустое', async () => {
    vi.mocked(requireCalcAccess).mockResolvedValue(staff('reviewer') as never);
    vi.mocked(prisma.gostPackage.findUnique).mockResolvedValue(
      pkg({
        calculation: {
          id: 'c1',
          name: 'Расчёт',
          customer: 'Заказчик',
          version: 1,
          status: 'approved',
        },
        project: { id: 'prj1', name: 'Проект', customer: 'Заказчик', code: null },
      }) as never,
    );

    const res = await getPackage(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: 'p1' }),
    });
    const body = await res.json();

    expect(body.package.reviewStage).toBe('tw');
    expect(body.package.twVersion).toBeNull();
  });
});
