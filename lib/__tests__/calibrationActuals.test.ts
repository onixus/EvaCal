import { describe, it, expect } from 'vitest';
import { realRatioOf, type CalibrationCalcRow } from '../calibration';

const d = new Date('2026-01-01');
const row = (over: Partial<CalibrationCalcRow>): CalibrationCalcRow => ({
  id: 'x',
  name: 'x',
  customer: 'c',
  projectId: null,
  version: 1,
  status: 'approved',
  answers: {},
  pmHours: 0,
  risks: [],
  updatedAt: d,
  stages: [
    { name: 'A', hours: 10, isApprovalTask: false, startDate: d, endDate: d, actualHours: 15 },
    { name: 'B', hours: 10, isApprovalTask: false, startDate: d, endDate: d, actualHours: null },
    { name: 'S', hours: 0, isApprovalTask: true, startDate: d, endDate: d, actualHours: 5 },
  ],
  ...over,
});

describe('калибровка: третий слой «факт»', () => {
  it('считает факт / утверждено только по этапам с фактом выигранной версии', () => {
    expect(realRatioOf(row({ wonVersion: true }))).toEqual({ hours: 15, ratio: 1.5 });
  });
  it('у невыигранной версии факта нет', () => {
    expect(realRatioOf(row({ wonVersion: false }))).toEqual({ hours: null, ratio: null });
  });
  it('без факта вовсе — null', () => {
    const r = row({ wonVersion: true });
    r.stages[0].actualHours = null;
    expect(realRatioOf(r).ratio).toBeNull();
  });
});
