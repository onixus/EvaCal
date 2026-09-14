import { describe, expect, it } from 'vitest';
import {
  buildArchitectBoard,
  buildPresaleBoard,
  parsePeriod,
  periodSince,
  type CalculationRow,
  type PackageRow,
  type UserRow,
} from '@/lib/leaderboard';

const users: UserRow[] = [
  { id: 'u-presale', username: 'ivanova', role: 'presale' },
  { id: 'u-presale2', username: 'petrov', role: 'presale' },
  { id: 'u-arch', username: 'architect', role: 'architect' },
  { id: 'u-arch2', username: 'sidorov', role: 'architect' },
];

const day = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-01-01T00:00:00Z');
const at = (d: number) => new Date(t0.getTime() + d * day);

function calc(
  createdBy: string,
  status: string,
  opts: { version?: number; days?: number } = {},
): CalculationRow {
  return {
    createdBy,
    status,
    version: opts.version ?? 1,
    createdAt: t0,
    updatedAt: at(opts.days ?? 0),
  };
}

describe('period parsing', () => {
  it('falls back to all-time on unknown values', () => {
    expect(parsePeriod(undefined)).toBe('all');
    expect(parsePeriod('7')).toBe('all');
    expect(parsePeriod('90')).toBe('90');
  });

  it('computes the lower bound', () => {
    expect(periodSince('all')).toBeNull();
    expect(periodSince('30', at(30))).toEqual(t0);
  });
});

describe('presale board', () => {
  it('ranks by conversion, marks low samples and resolves legacy authors', () => {
    const rows: CalculationRow[] = [
      calc('ivanova', 'approved', { days: 2 }),
      calc('ivanova', 'approved', { days: 4 }),
      calc('ivanova', 'pending_approval'),
      calc('u-presale2', 'draft'),
      calc('u-presale2', 'approved', { version: 2, days: 10 }),
      calc('presale-share', 'draft'),
    ];

    const board = buildPresaleBoard(rows, users);
    expect(board.all.map((e) => e.name)).toEqual(['ivanova', 'petrov', 'Гость по share-ссылке']);

    const [ivanova, petrov, guest] = board.all;
    expect(ivanova.total).toBe(3);
    expect(ivanova.conversion).toBeCloseTo(2 / 3, 2);
    expect(ivanova.medianCycleDays).toBe(3);
    expect(ivanova.lowSample).toBe(false);

    // id в createdBy разрешается в логин
    expect(petrov.total).toBe(2);
    expect(petrov.reworkRate).toBe(0.5);
    expect(petrov.lowSample).toBe(true);

    expect(guest.role).toBe('guest');
    expect(guest.score).toBeLessThan(petrov.score);
  });

  it('puts a single participant only into top', () => {
    const board = buildPresaleBoard([calc('ivanova', 'draft')], users);
    expect(board.top).toHaveLength(1);
    expect(board.bottom).toHaveLength(0);
  });

  it('takes three from each end of a big team', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => calc(n, 'draft'));
    const board = buildPresaleBoard(rows, users);
    expect(board.top).toHaveLength(3);
    expect(board.bottom).toHaveLength(3);
  });

  it('never lists one person in both top and bottom', () => {
    const rows = ['a', 'b', 'c', 'd'].map((n) => calc(n, 'draft'));
    const board = buildPresaleBoard(rows, users);
    expect(board.top).toHaveLength(2);
    expect(board.bottom).toHaveLength(2);
    const overlap = board.top.filter((t) => board.bottom.some((b) => b.name === t.name));
    expect(overlap).toHaveLength(0);
  });
});

describe('architect board', () => {
  function pkg(
    createdBy: string,
    status: string,
    opts: { approvedBy?: string; releasedBy?: string; turnaround?: number } = {},
  ): PackageRow {
    return {
      createdBy,
      releasedBy: opts.releasedBy ?? createdBy,
      approvedBy: opts.approvedBy ?? null,
      status,
      releasedAt: t0,
      approvedAt: status === 'approved' ? at(opts.turnaround ?? 1) : null,
    };
  }

  it('credits release, first-pass acceptance, GAP decisions and audit approvals', () => {
    const packages: PackageRow[] = [
      pkg('architect', 'approved', { approvedBy: 'sidorov', turnaround: 2 }),
      pkg('architect', 'approved', { approvedBy: 'sidorov', turnaround: 4 }),
      pkg('architect', 'under_review'),
      pkg('u-arch2', 'rejected'),
    ];
    const approvals = [{ actorId: 'u-arch' }, { actorId: 'u-arch' }, { actorId: null }];

    const board = buildArchitectBoard(packages, approvals, users);
    const arch = board.all.find((e) => e.name === 'architect')!;
    const sidorov = board.all.find((e) => e.name === 'sidorov')!;

    expect(arch.calcApproved).toBe(2);
    expect(arch.released).toBe(3);
    expect(arch.authoredApproved).toBe(2);
    expect(arch.authoredRejected).toBe(0);
    expect(arch.firstPassRate).toBe(1);
    expect(arch.medianTurnaroundDays).toBe(3);

    expect(sidorov.gapApproved).toBe(2);
    expect(sidorov.released).toBe(1);
    expect(sidorov.firstPassRate).toBe(0);
    expect(sidorov.medianTurnaroundDays).toBeNull();

    expect(board.top[0].name).toBe('architect');
    expect(board.bottom[0].name).toBe('sidorov');
  });

  it('uses a neutral acceptance when nothing was decided yet', () => {
    const board = buildArchitectBoard([pkg('architect', 'under_review')], [], users);
    const arch = board.all[0];
    expect(arch.firstPassRate).toBeNull();
    // 0.5*0.5 + 0.3*1 + 0.2*0.5 = 0.65
    expect(arch.score).toBe(65);
    expect(arch.lowSample).toBe(true);
  });
});
