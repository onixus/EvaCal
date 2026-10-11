import { describe, expect, it } from 'vitest';
import {
  currentDecision,
  validateDecisionInput,
  type DecisionCheckInput,
  type DecisionCheckState,
} from './decision';
import { affectedRequirementIds, reviewFlagsByRequirement, targetsPackage } from './review';

const passed = (id: string, over: Partial<DecisionCheckInput> = {}): DecisionCheckInput => ({
  id,
  requirementCode: `ТР-${id}`,
  status: 'passed',
  openRemarks: 0,
  needsReview: false,
  latestResultId: `res-${id}`,
  ...over,
});
const base = {
  commission: [{ name: 'Петров П.П.', position: 'Председатель' }],
  basis: 'Протокол заседания №1',
};

describe('правила решения комиссии', () => {
  it('без проверок решение не принимается', () => {
    const r = validateDecisionInput({ ...base, decision: 'accepted' }, []);
    expect(!r.ok && r.status).toBe(409);
  });

  it('«принять» — только когда всё пройдено без замечаний и пересмотра', () => {
    expect(validateDecisionInput({ ...base, decision: 'accepted' }, [passed('a')]).ok).toBe(true);
    for (const bad of [
      { status: 'failed' as const },
      { status: 'blocked' as const },
      { status: 'not_run' as const },
      { openRemarks: 1 },
      { needsReview: true },
    ]) {
      const r = validateDecisionInput({ ...base, decision: 'accepted' }, [
        passed('a'),
        passed('b', bad),
      ]);
      expect(!r.ok && r.status, JSON.stringify(bad)).toBe(409);
    }
  });

  it('«принять с замечаниями» — только с явным перечнем всех непройденных', () => {
    const checks = [
      passed('a'),
      passed('b', { status: 'failed' }),
      passed('c', { status: 'not_run' }),
    ];
    const ok = validateDecisionInput(
      {
        ...base,
        decision: 'accepted_with_remarks',
        exceptions: [
          { checkId: 'b', note: 'ускорить' },
          { checkId: 'c', note: 'провести до 01.12' },
        ],
      },
      checks,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.exceptions.map((e) => e.requirementCode)).toEqual(['ТР-b', 'ТР-c']);
      expect(ok.value.checksSnapshot).toHaveLength(3);
    }
    const missing = validateDecisionInput(
      { ...base, decision: 'accepted_with_remarks', exceptions: [{ checkId: 'b', note: 'x' }] },
      checks,
    );
    expect(!missing.ok && missing.error).toContain('ТР-c');
    const clean = validateDecisionInput(
      {
        ...base,
        decision: 'accepted_with_remarks',
        exceptions: [
          { checkId: 'a', note: 'x' },
          { checkId: 'b', note: 'x' },
          { checkId: 'c', note: 'x' },
        ],
      },
      checks,
    );
    expect(clean.ok).toBe(false);
    const emptyNote = validateDecisionInput(
      {
        ...base,
        decision: 'accepted_with_remarks',
        exceptions: [
          { checkId: 'b', note: ' ' },
          { checkId: 'c', note: 'x' },
        ],
      },
      checks,
    );
    expect(emptyNote.ok).toBe(false);
    const allPassed = validateDecisionInput(
      { ...base, decision: 'accepted_with_remarks', exceptions: [] },
      [passed('a')],
    );
    expect(allPassed.ok).toBe(false);
  });

  it('«не принимать» — с основанием и без перечня; комиссия и основание обязательны', () => {
    const checks = [passed('a', { status: 'failed' })];
    expect(validateDecisionInput({ ...base, decision: 'rejected' }, checks).ok).toBe(true);
    expect(validateDecisionInput({ ...base, decision: 'rejected', basis: ' ' }, checks).ok).toBe(
      false,
    );
    expect(
      validateDecisionInput({ ...base, decision: 'rejected', commission: [] }, checks).ok,
    ).toBe(false);
    expect(
      validateDecisionInput({ ...base, decision: 'rejected', commission: [{ name: '' }] }, checks)
        .ok,
    ).toBe(false);
    expect(validateDecisionInput({ ...base, decision: 'ok' }, checks).ok).toBe(false);
  });

  it('перечень не может ссылаться на проверку другой редакции', () => {
    const r = validateDecisionInput(
      {
        ...base,
        decision: 'accepted_with_remarks',
        exceptions: [{ checkId: 'zzz', note: 'x' }],
      },
      [passed('a', { status: 'failed' })],
    );
    expect(r.ok).toBe(false);
  });
});

describe('действующее решение', () => {
  const state = (over: Partial<DecisionCheckState> = {}): DecisionCheckState => ({
    ...passed('a', { latestResultId: 'r1' }),
    latestResultAt: '2026-10-01T00:00:00Z',
    ...over,
  });
  const snap = (over: Record<string, unknown> = {}) => ({
    checkId: 'a',
    resultId: 'r1',
    openRemarks: 0,
    needsReview: false,
    ...over,
  });
  const decision = (
    id: string,
    at: string,
    entries: Record<string, unknown>[],
    kind = 'accepted_with_remarks',
  ) => ({ id, decision: kind, decidedAt: at, checksSnapshot: entries });

  it('последнее решение действует, пока факты не менялись', () => {
    const res = currentDecision(
      [
        decision('d1', '2026-10-02T00:00:00Z', [snap({ resultId: 'r0' })]),
        decision('d2', '2026-10-03T00:00:00Z', [snap()]),
      ],
      [state()],
    );
    expect(res.decision?.id).toBe('d2');
    expect(res.stale).toBe(false);
  });

  it('новый результат или новая проверка после решения делают его устаревшим', () => {
    const d = [decision('d1', '2026-10-03T00:00:00Z', [snap()])];
    expect(
      currentDecision(d, [state({ latestResultId: 'r2', latestResultAt: '2026-10-04T00:00:00Z' })]),
    ).toMatchObject({ decision: null, stale: true });
    expect(
      currentDecision(d, [
        state(),
        state({ id: 'b', latestResultId: null, latestResultAt: null, status: 'not_run' }),
      ]),
    ).toMatchObject({ decision: null, stale: true });
    expect(currentDecision([], [])).toMatchObject({ decision: null, stale: false });
  });

  it('открытое замечание после решения делает его устаревшим', () => {
    const d = [decision('d1', '2026-10-03T00:00:00Z', [snap()], 'accepted')];
    expect(currentDecision(d, [state({ openRemarks: 1 })])).toMatchObject({
      decision: null,
      stale: true,
    });
  });

  it('запрос на изменение, поданный после решения, делает его устаревшим', () => {
    const d = [decision('d1', '2026-10-03T00:00:00Z', [snap()])];
    expect(currentDecision(d, [state({ needsReview: true })])).toMatchObject({
      decision: null,
      stale: true,
    });
  });

  it('«принять» устаревает, если проверка сейчас не чистая, даже при совпадающем снимке', () => {
    const outstanding = [state({ status: 'failed' })];
    const d = [decision('d1', '2026-10-03T00:00:00Z', [snap()], 'accepted')];
    expect(currentDecision(d, outstanding)).toMatchObject({ decision: null, stale: true });
    const remarks = [decision('d1', '2026-10-03T00:00:00Z', [snap()])];
    expect(currentDecision(remarks, outstanding).stale).toBe(false);
  });
});

describe('пересмотр проверок по запросам на изменение', () => {
  const cr = (over: Record<string, unknown> = {}) => ({
    id: 'cr1',
    seq: 3,
    title: 'Ускорить отчёт',
    status: 'submitted',
    basePackageId: 'p1',
    baseCalculationId: 'c1',
    resultPackageId: null,
    affectedRequirements: [{ id: 'r1', code: 'ТР-01', text: '...' }],
    proposedChanges: { summary: '', items: [{ kind: 'modify', requirementId: 'r2', text: '' }] },
    ...over,
  });
  const pkg = { id: 'p1', calculationId: 'c1' };

  it('затронутые и изменяемые требования помечаются', () => {
    expect(affectedRequirementIds(cr())).toEqual(['r1', 'r2']);
    const flags = reviewFlagsByRequirement(pkg, [cr()]);
    expect(flags.get('r1')?.[0]).toMatchObject({ label: 'ЗИ-03', status: 'submitted' });
    expect(flags.has('r2')).toBe(true);
  });

  it('черновики, отклонённые, отложенные и чужие редакции не помечают', () => {
    for (const status of ['draft', 'rejected', 'deferred']) {
      expect(reviewFlagsByRequirement(pkg, [cr({ status })]).size, status).toBe(0);
    }
    expect(reviewFlagsByRequirement(pkg, [cr({ basePackageId: 'p0' })]).size).toBe(0);
    expect(targetsPackage(cr({ basePackageId: null }), pkg)).toBe(true);
    expect(targetsPackage(cr({ basePackageId: null, baseCalculationId: 'c9' }), pkg)).toBe(false);
    expect(targetsPackage(cr({ status: 'accepted', resultPackageId: 'p1' }), pkg)).toBe(false);
  });
});
