import { describe, expect, it } from 'vitest';
import { changeRequestDrafts, notifiesEstimators } from './notify';
import { composeQueue } from '@/lib/review/queue';
import { notificationHref, serializeNotification } from '@/lib/review/notifications';

const cr = { id: 'cr1', projectId: 'p1', seq: 3, title: 'SSO', basePackageId: 'pkg1' };
const actor = { userId: 'u-arch', username: 'architect' };

describe('уведомления о запросах на изменение', () => {
  it('подача и возврат — оценщикам, оценка и решения — автору и инициатору', () => {
    expect(notifiesEstimators('submitted')).toBe(true);
    expect(notifiesEstimators('reopened')).toBe(true);
    for (const e of ['estimated', 'accepted', 'rejected', 'deferred'] as const) {
      expect(notifiesEstimators(e)).toBe(false);
    }
  });

  it('без повторов и без уведомления самому себе; ссылка на вкладку запросов', () => {
    const drafts = changeRequestDrafts({
      event: 'accepted',
      cr,
      recipientIds: ['u-presale', 'u-presale', 'u-arch', ''],
      actor,
      text: 'Согласовано',
    });
    expect(drafts).toEqual([
      {
        userId: 'u-presale',
        kind: 'cr_accepted',
        entityType: 'change_request',
        entityId: 'cr1',
        payload: {
          packageId: 'pkg1',
          projectId: 'p1',
          changeRequestId: 'cr1',
          crLabel: 'ЗИ-03',
          crTitle: 'SSO',
          actor: 'architect',
          text: 'Согласовано',
        },
      },
    ]);
    expect(notificationHref(drafts[0].payload)).toBe('/projects/p1?tab=changes');
    const row = serializeNotification({
      id: 'n1',
      kind: 'cr_accepted',
      entityType: 'change_request',
      entityId: 'cr1',
      payload: drafts[0].payload,
      dueAt: null,
      createdAt: new Date(0),
      readAt: null,
    });
    expect(row).toMatchObject({
      label: 'Запрос на изменение принят',
      href: '/projects/p1?tab=changes',
    });
  });

  it('уведомления о комплекте по-прежнему ведут в ревью', () => {
    expect(notificationHref({ packageId: 'pkg1' })).toBe('/review/pkg1');
  });
});

describe('очередь: запросы на изменение', () => {
  const base = {
    assignments: [],
    fixedComments: [],
    returned: [],
    lines: [],
    now: new Date('2026-11-24T00:00:00Z'),
  };
  const source = (over: Record<string, unknown>) => ({
    id: 'cr1',
    projectId: 'p1',
    seq: 1,
    title: 'SSO',
    status: 'submitted',
    basePackageId: null,
    estimatedAt: null,
    updatedAt: new Date('2026-11-20T00:00:00Z'),
    ...over,
  });

  it('архитектору: оценить, а после оценки — принять решение', () => {
    const items = composeQueue({
      ...base,
      actor: { kind: 'staff', actorId: 'u-arch', role: 'architect' },
      changeRequests: [
        source({}),
        source({ id: 'cr2', seq: 2, estimatedAt: new Date('2026-11-21T00:00:00Z') }),
        source({ id: 'cr3', seq: 3, status: 'draft' }),
        source({ id: 'cr4', seq: 4, status: 'accepted' }),
      ],
    });
    expect(items.map((i) => [i.kind, i.entityId, i.title])).toEqual([
      ['change_request', 'cr1', 'Оценить ЗИ-01 «SSO»'],
      ['change_request', 'cr2', 'Принять решение по ЗИ-02 «SSO»'],
    ]);
    expect(items[0].href).toBe('/projects/p1?tab=changes');
  });

  it('пресейлу и ролям ревью запросы на оценку не показываются', () => {
    for (const role of ['presale', 'techwriter', 'gap']) {
      expect(
        composeQueue({
          ...base,
          actor: { kind: 'staff', actorId: 'u', role },
          changeRequests: [source({})],
        }),
      ).toEqual([]);
    }
  });
});
