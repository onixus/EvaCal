import { describe, it, expect } from 'vitest';
import { daysBetween, projectSchedule, stageSchedule } from '../schedule';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const row = (
  id: string,
  start: string,
  end: string,
  aStart: string | null,
  aEnd: string | null,
  approval = false,
) => ({
  id,
  name: id,
  role: 'engineer',
  isApprovalTask: approval,
  startDate: d(start),
  endDate: d(end),
  actualStartDate: aStart ? d(aStart) : null,
  actualEndDate: aEnd ? d(aEnd) : null,
});

describe('контроль сроков', () => {
  it('сдвиги и статус этапа', () => {
    const today = d('2026-03-20');
    const done = stageSchedule(
      row('a', '2026-03-02', '2026-03-06', '2026-03-03', '2026-03-10'),
      today,
    );
    expect(done).toMatchObject({
      status: 'done',
      startSlipDays: 1,
      endSlipDays: 4,
      plannedDays: 5,
      actualDays: 8,
    });
    const overdue = stageSchedule(row('b', '2026-03-09', '2026-03-13', '2026-03-09', null), today);
    expect(overdue).toMatchObject({ status: 'overdue', overdueDays: 7, endSlipDays: null });
    const inProgress = stageSchedule(
      row('c', '2026-03-16', '2026-03-27', '2026-03-16', null),
      today,
    );
    expect(inProgress.status).toBe('in_progress');
    expect(stageSchedule(row('d', '2026-04-01', '2026-04-05', null, null), today).status).toBe(
      'planned',
    );
    expect(daysBetween(d('2026-03-01'), d('2026-02-27'))).toBe(-2);
  });

  it('сводка: прогноз = план + максимальный сдвиг, согласования не считаются этапами', () => {
    const today = d('2026-03-20');
    const s = projectSchedule(
      [
        row('a', '2026-03-02', '2026-03-06', '2026-03-02', '2026-03-10'),
        row('appr', '2026-03-09', '2026-03-11', null, null, true),
        row('b', '2026-03-12', '2026-03-13', '2026-03-12', null),
        row('c', '2026-03-23', '2026-04-03', null, null),
      ],
      today,
    )!;
    expect(s.total).toBe(3);
    expect(s.done).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.currentSlipDays).toBe(7); // просрочка b (13.03 → 20.03) больше сдвига a (4)
    expect(s.plannedEnd).toBe('2026-04-03');
    expect(s.forecastEnd).toBe('2026-04-10');
    expect(s.status).toBe('late');
    expect(s.medianEndSlipDays).toBe(4);
  });

  it('статусы: не начат, в графике, риск, завершён', () => {
    const early = projectSchedule(
      [row('a', '2026-05-01', '2026-05-05', null, null)],
      d('2026-04-01'),
    )!;
    expect(early.status).toBe('not_started');
    const ok = projectSchedule(
      [row('a', '2026-03-01', '2026-03-05', '2026-03-01', '2026-03-05')],
      d('2026-03-03'),
    )!;
    expect(ok.status).toBe('completed');
    const risk = projectSchedule(
      [
        row('a', '2026-03-01', '2026-03-05', '2026-03-01', '2026-03-07'),
        row('b', '2026-03-08', '2026-03-30', null, null),
      ],
      d('2026-03-10'),
    )!;
    expect(risk.status).toBe('at_risk');
    const onTrack = projectSchedule(
      [
        row('a', '2026-03-01', '2026-03-05', '2026-03-01', '2026-03-04'),
        row('b', '2026-03-08', '2026-03-30', null, null),
      ],
      d('2026-03-10'),
    )!;
    expect(onTrack.status).toBe('on_track');
    expect(projectSchedule([], d('2026-03-10'))).toBeNull();
  });
});
