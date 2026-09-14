import { describe, it, expect } from 'vitest';
import { buildArchitectBoard, buildPresaleBoard } from '../leaderboard';

const users = [
  { id: 'u1', username: 'ann', role: 'presale' },
  { id: 'u2', username: 'bob', role: 'architect' },
];

describe('рейтинг: исходы сделок и точность (E1)', () => {
  it('пресейл получает win rate по решённым сделкам', () => {
    const board = buildPresaleBoard(
      [
        {
          createdBy: 'u1',
          status: 'approved',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      users,
      [
        { createdBy: 'u1', dealStatus: 'won' },
        { createdBy: 'u1', dealStatus: 'lost' },
        { createdBy: 'u1', dealStatus: 'cancelled' },
      ],
    );
    expect(board.all[0]).toMatchObject({ name: 'ann', won: 1, lost: 1, winRate: 0.5 });
  });

  it('без сделок win rate null', () => {
    const board = buildPresaleBoard(
      [
        {
          createdBy: 'u1',
          status: 'draft',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      users,
    );
    expect(board.all[0].winRate).toBeNull();
  });

  it('архитектор получает медиану |отклонения| по согласованным расчётам', () => {
    const board = buildArchitectBoard([], [{ actorId: 'u2', entityId: 'c1' }], users, [
      { approvedBy: 'u2', deviation: 0.2 },
      { approvedBy: 'u2', deviation: -0.1 },
      { approvedBy: 'u2', deviation: 0.3 },
    ]);
    expect(board.all[0]).toMatchObject({
      name: 'bob',
      accuracySamples: 3,
      medianAbsDeviation: 0.2,
    });
  });
});
