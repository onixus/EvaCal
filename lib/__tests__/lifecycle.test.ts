import { describe, expect, it } from 'vitest';
import {
  formatDays,
  freshnessFor,
  LIFECYCLE_STEPS,
  resolveLifecycle,
  summarizeLifecycle,
  type LifecycleInput,
} from '../lifecycle';

const NOW = new Date('2026-09-15T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function input(over: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    project: {
      id: 'p1',
      status: 'active',
      dealStatus: 'open',
      dealClosedAt: null,
      createdAt: daysAgo(30),
    },
    calculation: null,
    gostPackage: null,
    ...over,
  };
}

const calc = (status: string, updatedDaysAgo: number) => ({
  id: 'c1',
  status,
  createdAt: daysAgo(updatedDaysAgo + 1),
  updatedAt: daysAgo(updatedDaysAgo),
});

const pkg = (status: string, reviewStage: string, over: Record<string, unknown> = {}) => ({
  id: 'g1',
  calculationId: 'c1',
  status,
  reviewStage,
  createdAt: daysAgo(10),
  updatedAt: daysAgo(3),
  releasedAt: daysAgo(6),
  approvedAt: null,
  ...over,
});

describe('resolveLifecycle: этап проекта по статусам расчёта, комплекта и сделки', () => {
  it('проект без расчётов стоит на первом шаге и ведёт в мастер', () => {
    const s = resolveLifecycle(input(), NOW);
    expect(s.stage).toBe('estimate');
    expect(s.index).toBe(0);
    expect(s.days).toBe(30);
    expect(s.next?.href).toBe('/presale?projectId=p1');
    expect(s.attention).toBe('stale');
  });

  it('черновик, согласование и утверждение сметы идут по порядку', () => {
    expect(resolveLifecycle(input({ calculation: calc('draft', 1) }), NOW).stage).toBe('estimate');
    const review = resolveLifecycle(input({ calculation: calc('pending_approval', 1) }), NOW);
    expect(review.stage).toBe('estimate_review');
    expect(review.next?.href).toBe('/architect/c1');
    const approved = resolveLifecycle(input({ calculation: calc('approved', 2) }), NOW);
    expect(approved.stage).toBe('estimate_approved');
    expect(approved.next?.href).toBe('/calculations/c1/studio');
    expect(approved.days).toBe(2);
  });

  it('комплект: черновик, нормоконтроль, ГАП, выпуск', () => {
    const base = { calculation: calc('approved', 20) };
    expect(resolveLifecycle(input({ ...base, gostPackage: pkg('draft', 'tw') }), NOW).stage).toBe(
      'package',
    );
    const tw = resolveLifecycle(input({ ...base, gostPackage: pkg('under_review', 'tw') }), NOW);
    expect(tw.stage).toBe('review_tw');
    // Нормоконтроль отсчитывается от выпуска, а не от последней правки.
    expect(tw.days).toBe(6);
    expect(tw.freshness).toBe('stale');
    expect(tw.next?.href).toBe('/review/g1');

    const gap = resolveLifecycle(input({ ...base, gostPackage: pkg('under_review', 'gap') }), NOW);
    expect(gap.stage).toBe('review_gap');
    expect(gap.days).toBe(3);
    expect(gap.freshness).toBe('warn');

    const released = resolveLifecycle(
      input({ ...base, gostPackage: pkg('approved', 'done', { approvedAt: daysAgo(1) }) }),
      NOW,
    );
    expect(released.stage).toBe('released');
    expect(released.days).toBe(1);
    expect(released.next?.href).toBe('/projects/p1#deal');
  });

  it('отклонённый комплект остаётся на шаге комплекта с тревогой', () => {
    const s = resolveLifecycle(
      input({ calculation: calc('approved', 20), gostPackage: pkg('rejected', 'tw') }),
      NOW,
    );
    expect(s.stage).toBe('package');
    expect(s.attention).toBe('rejected');
    expect(s.next?.href).toBe('/calculations/c1/studio');
  });

  it('закрытая сделка — последний шаг; проигрыш не считается зависанием', () => {
    const won = resolveLifecycle(
      input({
        project: {
          id: 'p1',
          status: 'active',
          dealStatus: 'won',
          dealClosedAt: daysAgo(40),
          createdAt: daysAgo(90),
        },
        calculation: calc('approved', 50),
      }),
      NOW,
    );
    expect(won.stage).toBe('deal_closed');
    expect(won.index).toBe(LIFECYCLE_STEPS.length - 1);
    expect(won.attention).toBe('none');
    expect(won.next?.label).toMatch(/факт/i);

    const lost = resolveLifecycle(
      input({
        project: {
          id: 'p1',
          status: 'active',
          dealStatus: 'lost',
          dealClosedAt: daysAgo(40),
          createdAt: daysAgo(90),
        },
      }),
      NOW,
    );
    expect(lost.attention).toBe('lost');
    expect(lost.next).toBeNull();
  });

  it('пауза и архив не зависают, даже если этап давно не двигался', () => {
    const s = resolveLifecycle(
      input({
        project: {
          id: 'p1',
          status: 'on_hold',
          dealStatus: 'open',
          dealClosedAt: null,
          createdAt: daysAgo(90),
        },
        calculation: calc('draft', 60),
      }),
      NOW,
    );
    expect(s.attention).toBe('paused');
    expect(s.freshness).toBe('fresh');
  });
});

describe('свежесть и сводка', () => {
  it('пороги зависят от шага: ревью короче сметы', () => {
    expect(freshnessFor('review_tw', 2)).toBe('warn');
    expect(freshnessFor('review_tw', 5)).toBe('stale');
    expect(freshnessFor('estimate', 5)).toBe('fresh');
    expect(freshnessFor('deal_closed', 400)).toBe('fresh');
  });

  it('formatDays: сегодня / N дн.', () => {
    expect(formatDays(0)).toBe('сегодня');
    expect(formatDays(4)).toBe('4 дн.');
  });

  it('сводка считает проекты по шагам и тревоги', () => {
    const states = [
      resolveLifecycle(input({ calculation: calc('draft', 1) }), NOW),
      resolveLifecycle(input({ calculation: calc('draft', 30) }), NOW),
      resolveLifecycle(
        input({ calculation: calc('approved', 20), gostPackage: pkg('rejected', 'tw') }),
        NOW,
      ),
    ];
    const summary = summarizeLifecycle(states);
    expect(summary.total).toBe(3);
    expect(summary.byStage.estimate).toBe(2);
    expect(summary.byStage.package).toBe(1);
    expect(summary.stale).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.attention).toBe(2);
  });
});
