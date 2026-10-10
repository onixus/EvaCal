import { describe, expect, it } from 'vitest';
import {
  HIGH_MIN_SAMPLES,
  MIN_SAMPLES,
  buildNormProposals,
  confidenceFor,
  snapshotMatches,
  tukeyFences,
  type NormCalcRow,
  type NormStageTemplate,
} from '../normProposals';

const ST: NormStageTemplate = {
  id: 'st1',
  name: 'Обследование',
  role: 'analyst',
  baseHours: 10,
  hoursPerUnit: 2,
  driverFieldKey: 'sites',
};

const END = new Date('2026-05-01T00:00:00Z');

/** Выигранная версия с одним этапом «Обследование»: формула = 10 + 2 × sites. */
function calc(
  i: number,
  actualHours: number | null,
  opts: { sites?: number; closed?: boolean; ended?: boolean } = {},
): NormCalcRow {
  return {
    id: `c${i}`,
    name: `Проект ${i}`,
    version: 1,
    answers: { sites: opts.sites ?? 5 }, // формула 20 ч
    actualsClosed: opts.closed ?? true,
    stages: [
      {
        id: `s${i}`,
        name: 'Обследование',
        role: 'analyst',
        hours: 22,
        isApprovalTask: false,
        actualHours,
        actualEndDate: opts.ended ? END : null,
      },
      {
        id: `a${i}`,
        name: 'Обследование',
        role: 'analyst',
        hours: 0,
        isApprovalTask: true,
        actualHours: 999,
        actualEndDate: END,
      },
    ],
  };
}

describe('buildNormProposals', () => {
  it('предлагает норматив по медиане «факт / формула»', () => {
    const calcs = [30, 30, 30].map((h, i) => calc(i, h));
    const { drafts } = buildNormProposals([ST], calcs);
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d.explanation.ratio).toBe(1.5);
    expect(d.proposedBaseHours).toBe(15);
    expect(d.proposedHoursPerUnit).toBe(3);
    expect(d.sampleSize).toBe(3);
    expect(d.completeness).toBe(1);
    // Этап согласования не попал в выборку.
    expect(d.explanation.samples.every((s) => s.stageIds.length === 1)).toBe(true);
    expect(d.explanation.totals).toEqual({ planHours: 66, actualHours: 90, formulaHours: 60 });
  });

  it('отсутствующий факт не считается нулём и снижает полноту', () => {
    const calcs = [calc(1, 30), calc(2, 30), calc(3, 30), calc(4, null), calc(5, null)];
    const { drafts } = buildNormProposals([ST], calcs);
    const d = drafts[0];
    // Учтены только 3 полных наблюдения; пропуски — отдельный статус, не 0 ч.
    expect(d.sampleSize).toBe(3);
    expect(d.explanation.samples.filter((s) => s.status === 'no-actuals')).toHaveLength(2);
    expect(d.explanation.samples.find((s) => s.calculationId === 'c4')?.actualHours).toBeNull();
    expect(d.completeness).toBe(0.6);
    expect(d.confidence).toBe('low');
  });

  it('пропуск факта не тянет медиану вниз', () => {
    const calcs = [calc(1, 30), calc(2, null), calc(3, null), calc(4, 30), calc(5, null)];
    const { drafts } = buildNormProposals([ST], calcs);
    // С нулями вместо null медиана была бы 0 — норматив ушёл бы в ноль.
    expect(drafts[0].explanation.ratio).toBe(1.5);
    expect(drafts[0].proposedBaseHours).toBe(15);
  });

  it('незавершённые этапы открытого проекта в выборку не входят', () => {
    const calcs = [
      calc(1, 5, { closed: false }), // в работе: частичный факт
      calc(2, 30, { closed: false, ended: true }), // этап завершён
      calc(3, 30),
      calc(4, 30),
    ];
    const { drafts } = buildNormProposals([ST], calcs);
    expect(drafts[0].explanation.inProgress).toBe(1);
    expect(drafts[0].explanation.considered).toBe(3);
    expect(drafts[0].explanation.ratio).toBe(1.5);
  });

  it('малая выборка — только низкая достоверность', () => {
    const { drafts } = buildNormProposals([ST], [calc(1, 30), calc(2, 30)]);
    expect(drafts[0].sampleSize).toBeLessThan(MIN_SAMPLES);
    expect(drafts[0].confidence).toBe('low');
  });

  it('высокая — только при достаточном числе полных наблюдений', () => {
    const many = Array.from({ length: HIGH_MIN_SAMPLES }, (_, i) => calc(i, 30 + (i % 2)));
    expect(buildNormProposals([ST], many).drafts[0].confidence).toBe('high');

    const fewer = many.slice(0, HIGH_MIN_SAMPLES - 1);
    expect(buildNormProposals([ST], fewer).drafts[0].confidence).toBe('medium');

    // Полнота 8/9 < 0.9 — не высокая, даже при 8 полных наблюдениях.
    const incomplete = [...many, calc(99, null)];
    const d = buildNormProposals([ST], incomplete).drafts[0];
    expect(d.sampleSize).toBe(HIGH_MIN_SAMPLES);
    expect(d.completeness).toBeLessThan(0.9);
    expect(d.confidence).toBe('medium');
  });

  it('выбросы исключаются и показываются в объяснении', () => {
    const calcs = [30, 31, 29, 30, 300].map((h, i) => calc(i, h));
    const d = buildNormProposals([ST], calcs).drafts[0];
    expect(d.explanation.outliers).toBe(1);
    expect(d.explanation.samples.find((s) => s.actualHours === 300)?.status).toBe('outlier');
    expect(d.sampleSize).toBe(4);
    expect(d.explanation.ratio).toBe(1.5);
  });

  it('факт в пределах допуска — без предложения', () => {
    const { drafts, skipped } = buildNormProposals(
      [ST],
      [20, 20.5, 19.8].map((h, i) => calc(i, h)),
    );
    expect(drafts).toHaveLength(0);
    expect(skipped[0].reason).toBe('within-tolerance');
  });

  it('без полного факта — без предложения', () => {
    const { drafts, skipped } = buildNormProposals([ST], [calc(1, null), calc(2, null)]);
    expect(drafts).toHaveLength(0);
    expect(skipped[0].reason).toBe('no-complete-samples');
  });

  it('неоднозначный этап шаблона пропускается', () => {
    const { drafts, skipped } = buildNormProposals(
      [ST, { ...ST, id: 'st2' }],
      [calc(1, 30), calc(2, 30), calc(3, 30)],
    );
    expect(drafts).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(['ambiguous-template', 'ambiguous-template']);
  });

  it('отпечаток стабилен для тех же данных и меняется вместе с ними', () => {
    const calcs = [30, 30, 30].map((h, i) => calc(i, h));
    const a = buildNormProposals([ST], calcs).drafts[0].fingerprint;
    const b = buildNormProposals([ST], [...calcs].reverse()).drafts[0].fingerprint;
    expect(a).toBe(b);
    const c = buildNormProposals([ST], [...calcs, calc(9, 32)]).drafts[0].fingerprint;
    expect(c).not.toBe(a);
  });
});

describe('confidenceFor', () => {
  it('ограничения сверху применяются раньше высокой', () => {
    expect(confidenceFor(2, 1, 0).level).toBe('low');
    expect(confidenceFor(20, 0.5, 0).level).toBe('low');
    expect(confidenceFor(20, 1, 0.9).level).toBe('medium');
    expect(confidenceFor(20, 1, 0.1).level).toBe('high');
  });
});

describe('tukeyFences / snapshotMatches', () => {
  it('без отсечения на малой выборке', () => {
    expect(tukeyFences([1, 2, 100])).toBeNull();
    expect(tukeyFences([1, 1, 1, 100])).not.toBeNull();
  });
  it('сверка снимка: норматив, драйвер, имя и роль', () => {
    const p = {
      currentStageName: 'Обследование',
      currentStageRole: 'analyst',
      currentDriverFieldKey: 'sites',
      currentBaseHours: 10,
      currentHoursPerUnit: 2,
    };
    const st = {
      name: 'Обследование',
      role: 'analyst',
      driverFieldKey: 'sites' as string | null,
      baseHours: 10,
      hoursPerUnit: 2,
    };
    expect(snapshotMatches(p, st)).toBe(true);
    expect(snapshotMatches(p, { ...st, baseHours: 11 })).toBe(false);
    expect(snapshotMatches(p, { ...st, driverFieldKey: 'users' })).toBe(false);
    expect(snapshotMatches(p, { ...st, driverFieldKey: null })).toBe(false);
    expect(snapshotMatches(p, { ...st, name: 'Аудит' })).toBe(false);
    expect(snapshotMatches(p, { ...st, role: 'architect' })).toBe(false);
  });
});

describe('замечания ревью #120', () => {
  it('отрицательный норматив пропускает этап, а не весь прогон', () => {
    const neg = { ...ST, id: 'neg', name: 'Минус', baseHours: -5 };
    const calcs = [30, 30, 30].map((h, i) => calc(i, h));
    const { drafts, skipped } = buildNormProposals([neg, ST], calcs);
    expect(drafts.map((d) => d.stageTemplateId)).toEqual(['st1']);
    expect(skipped).toEqual([
      expect.objectContaining({ stageTemplateId: 'neg', reason: 'negative-norm' }),
    ]);
    const negUnit = { ...ST, hoursPerUnit: -1 };
    expect(buildNormProposals([negUnit], calcs).skipped[0].reason).toBe('negative-norm');
  });

  it('с порогом сравнивается точная полнота, хранится округлённая', () => {
    // 16 полных из 23: 0.696 < 0.7, округлённая 0.7 — всё равно низкая.
    const low = [
      ...Array.from({ length: 16 }, (_, i) => calc(i, 30)),
      ...Array.from({ length: 7 }, (_, i) => calc(100 + i, null)),
    ];
    const a = buildNormProposals([ST], low).drafts[0];
    expect(a.completeness).toBe(0.7);
    expect(a.confidence).toBe('low');
    // 26 из 29: 0.897 < 0.9, округлённая 0.9 — не высокая.
    const mid = [
      ...Array.from({ length: 26 }, (_, i) => calc(i, 30)),
      ...Array.from({ length: 3 }, (_, i) => calc(100 + i, null)),
    ];
    const b = buildNormProposals([ST], mid).drafts[0];
    expect(b.completeness).toBe(0.9);
    expect(b.confidence).toBe('medium');
  });

  it('нет ответа-драйвера — наблюдение неполное, а не драйвер 0', () => {
    const noDriver = { ...calc(9, 30), answers: {} };
    const blank = { ...calc(8, 30), answers: { sites: '' } };
    const calcs = [calc(1, 30), calc(2, 30), calc(3, 30), noDriver, blank];
    const d = buildNormProposals([ST], calcs).drafts[0];
    const s9 = d.explanation.samples.find((s) => s.calculationId === 'c9')!;
    expect(s9.status).toBe('no-driver');
    expect(s9.ratio).toBeNull();
    expect(d.explanation.samples.find((s) => s.calculationId === 'c8')?.status).toBe('no-driver');
    expect(d.sampleSize).toBe(3);
    expect(d.completeness).toBe(0.6);
    expect(d.confidence).toBe('low');
    // Явный 0 — законный ответ.
    const zero = { ...calc(7, 30), answers: { sites: 0 } };
    const z = buildNormProposals([ST], [zero]).drafts[0];
    expect(z.explanation.samples[0]).toMatchObject({
      status: 'used',
      driverValue: 0,
      formulaHours: 10,
    });
  });

  it('все полные наблюдения с формулой 0 ч — своя причина пропуска', () => {
    const zeroSt = { ...ST, baseHours: 0, hoursPerUnit: 0 };
    const { drafts, skipped } = buildNormProposals([zeroSt], [calc(1, 30), calc(2, 30)]);
    expect(drafts).toHaveLength(0);
    expect(skipped[0].reason).toBe('zero-formula');
  });

  it('отпечаток учитывает драйвер, имя и роль этапа', () => {
    const calcs = [30, 30, 30].map((h, i) => calc(i, h));
    const a = buildNormProposals([ST], calcs).drafts[0];
    expect(a).toMatchObject({
      currentStageName: 'Обследование',
      currentStageRole: 'analyst',
      currentDriverFieldKey: 'sites',
    });
    const renamedCalcs = calcs.map((c) => ({
      ...c,
      answers: { users: 5 },
    }));
    const b = buildNormProposals([{ ...ST, driverFieldKey: 'users' }], renamedCalcs).drafts[0];
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });
});
