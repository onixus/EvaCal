import { describe, expect, it } from 'vitest';
import {
  canRecordAcceptance,
  checkRemarkTransition,
  currentStatus,
  evidenceKeyPrefix,
  extractCheckSeeds,
  isPackageEligibleForChecks,
  latestResult,
  parseEvidenceRefs,
  summarizeChecks,
  validateEvidenceFile,
  validateResultInput,
} from './rules';

const now = new Date('2026-10-29T12:00:00Z');

describe('состояние проверки', () => {
  it('без результатов — не проводилась, а не пройдена', () => {
    expect(currentStatus([])).toBe('not_run');
    expect(latestResult([])).toBeNull();
  });

  it('текущее состояние — последний результат, повторная проверка побеждает', () => {
    const results = [
      { id: 'r1', status: 'failed', createdAt: '2026-10-01T10:00:00Z' },
      { id: 'r3', status: 'passed', createdAt: '2026-10-03T10:00:00Z' },
      { id: 'r2', status: 'blocked', createdAt: '2026-10-02T10:00:00Z' },
    ];
    expect(currentStatus(results)).toBe('passed');
    expect(latestResult(results)?.id).toBe('r3');
    // Явный сброс тоже результат: после него снова «не проводилась».
    expect(
      currentStatus([...results, { id: 'r4', status: 'not_run', createdAt: '2026-10-04' }]),
    ).toBe('not_run');
  });

  it('неизвестное состояние в журнале не превращается в «пройдена»', () => {
    expect(currentStatus([{ id: 'x', status: 'ok', createdAt: now }])).toBe('not_run');
  });

  it('при равном времени порядок стабилен', () => {
    const t = '2026-10-01T10:00:00Z';
    const a = { id: 'a', status: 'failed', createdAt: t };
    const b = { id: 'b', status: 'passed', createdAt: t };
    expect(latestResult([a, b])?.id).toBe(latestResult([b, a])?.id);
  });
});

describe('валидация результата', () => {
  const full = {
    executorName: 'Иванов И.И.',
    executedAt: '2026-10-28T09:00:00Z',
    actualResult: 'Отчёт сформирован за 3 с',
  };

  it.each(['passed', 'failed'])(
    '%s требует исполнителя, дату и фактический результат',
    (status) => {
      expect(validateResultInput({ status, ...full }, now).ok).toBe(true);
      for (const missing of ['executorName', 'executedAt', 'actualResult'] as const) {
        const r = validateResultInput({ status, ...full, [missing]: '  ' }, now);
        expect(r.ok, missing).toBe(false);
        if (!r.ok) expect(r.status).toBe(400);
      }
    },
  );

  it('заблокированная проверка требует причину', () => {
    expect(validateResultInput({ status: 'blocked' }, now).ok).toBe(false);
    expect(validateResultInput({ status: 'blocked', actualResult: 'Нет стенда' }, now).ok).toBe(
      true,
    );
  });

  it('явный сброс в «не проводилась» допустим без исполнителя', () => {
    const r = validateResultInput({ status: 'not_run' }, now);
    expect(r.ok && r.value.status).toBe('not_run');
  });

  it('отклоняет неизвестное состояние, будущую и некорректную дату', () => {
    expect(validateResultInput({ ...full }, now).ok).toBe(false);
    expect(validateResultInput({ status: 'ok', ...full }, now).ok).toBe(false);
    expect(
      validateResultInput({ status: 'passed', ...full, executedAt: '2026-11-01T00:00:00Z' }, now)
        .ok,
    ).toBe(false);
    expect(validateResultInput({ status: 'passed', ...full, executedAt: 'вчера' }, now).ok).toBe(
      false,
    );
  });

  it('нормализует пробелы и даты', () => {
    const r = validateResultInput({ status: 'passed', ...full, executorName: '  Петров ' }, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.executorName).toBe('Петров');
      expect(r.value.executedAt?.toISOString()).toBe('2026-10-28T09:00:00.000Z');
    }
  });
});

describe('засев проверок из снимка', () => {
  it('берёт требования с критерием (legacy) или методом (v2), пропускает прочие', () => {
    const seeds = extractCheckSeeds({
      requirements: [
        { id: 'r1', code: 'ТР-Ф-01', title: 'Отчёт', criterion: 'Формируется за 5 с' },
        {
          id: 'r2',
          code: 'ТР-Ф-02',
          title: 'Вход',
          acceptanceCriteria: ['Вход по SSO', ' '],
          verificationMethod: 'demonstration',
        },
        { id: 'r3', code: 'ТР-Ф-03', title: 'Метод без критерия', verificationMethod: 'TEST' },
        { id: 'r4', code: 'ТР-Ф-04', title: 'Без критерия' },
        { id: 'r1', code: 'дубль', criterion: 'x' },
        null,
        { code: 'без id', criterion: 'x' },
      ],
    });
    expect(seeds.map((s) => s.requirementId)).toEqual(['r1', 'r2', 'r3']);
    expect(seeds[0]).toMatchObject({ method: null, criteria: ['Формируется за 5 с'], order: 0 });
    expect(seeds[1]).toMatchObject({ method: 'DEMONSTRATION', criteria: ['Вход по SSO'] });
    expect(seeds[2]).toMatchObject({ method: 'TEST', criteria: [] });
  });

  it('пустой или битый снимок не даёт проверок', () => {
    expect(extractCheckSeeds(null)).toEqual([]);
    expect(extractCheckSeeds({})).toEqual([]);
    expect(extractCheckSeeds({ requirements: 'x' })).toEqual([]);
  });
});

describe('комплект и роли', () => {
  it('проверки только для утверждённой редакции', () => {
    expect(isPackageEligibleForChecks({ status: 'approved', reviewStage: 'done' })).toBe(true);
    expect(isPackageEligibleForChecks({ status: 'under_review', reviewStage: 'gap' })).toBe(false);
    expect(isPackageEligibleForChecks({ status: 'draft' })).toBe(false);
    expect(isPackageEligibleForChecks({ status: 'rejected', reviewStage: 'gap' })).toBe(false);
    expect(isPackageEligibleForChecks({ status: 'archived', reviewStage: 'done' })).toBe(false);
  });

  it('записывают результаты архитектор, ГАП и админ', () => {
    expect(['architect', 'gap', 'admin'].every(canRecordAcceptance)).toBe(true);
    expect(['presale', 'techwriter', 'reviewer', null, undefined].some(canRecordAcceptance)).toBe(
      false,
    );
  });
});

describe('жизненный цикл замечания', () => {
  const remark = { status: 'open', createdAt: '2026-10-10T10:00:00Z' };
  const resolved = { ...remark, status: 'resolved' };
  const retest = (over: Partial<{ status: string; createdAt: string; checkId: string }> = {}) => ({
    id: 'r9',
    checkId: 'c1',
    status: 'passed',
    createdAt: '2026-10-11T10:00:00Z',
    ...over,
  });

  it('открыто → устранено → проверено пройденной повторной проверкой', () => {
    expect(checkRemarkTransition(remark, 'resolve')).toEqual({ ok: true, value: 'resolved' });
    expect(checkRemarkTransition(resolved, 'verify', retest(), 'c1')).toEqual({
      ok: true,
      value: 'verified',
    });
    expect(checkRemarkTransition(resolved, 'reopen')).toEqual({ ok: true, value: 'open' });
  });

  it('снять без повторной проверки, непройденной или ранней — нельзя', () => {
    expect(checkRemarkTransition(resolved, 'verify', null, 'c1').ok).toBe(false);
    expect(checkRemarkTransition(resolved, 'verify', retest({ status: 'failed' }), 'c1').ok).toBe(
      false,
    );
    expect(
      checkRemarkTransition(resolved, 'verify', retest({ createdAt: '2026-10-09T00:00:00Z' }), 'c1')
        .ok,
    ).toBe(false);
    expect(checkRemarkTransition(resolved, 'verify', retest({ checkId: 'c2' }), 'c1').ok).toBe(
      false,
    );
    expect(checkRemarkTransition(remark, 'verify', retest(), 'c1').ok).toBe(false);
  });

  it('проверенное замечание закрыто окончательно', () => {
    const verified = { ...remark, status: 'verified' };
    for (const action of ['resolve', 'reopen', 'verify'] as const) {
      expect(checkRemarkTransition(verified, action, retest(), 'c1').ok).toBe(false);
    }
  });
});

describe('сводка и вложения', () => {
  it('считает состояния и открытые замечания', () => {
    expect(
      summarizeChecks([
        { status: 'passed', openRemarks: 0 },
        { status: 'not_run', openRemarks: 0 },
        { status: 'failed', openRemarks: 2 },
      ]),
    ).toEqual({
      total: 3,
      byStatus: { not_run: 1, passed: 1, failed: 1, blocked: 0 },
      openRemarks: 2,
    });
  });

  it('ограничивает размер и тип файла', () => {
    expect(validateEvidenceFile({ name: 'p.pdf', size: 10, type: 'application/pdf' }).ok).toBe(
      true,
    );
    expect(validateEvidenceFile({ name: 'p.PNG', size: 10, type: '' }).ok).toBe(true);
    const big = validateEvidenceFile({ name: 'p.pdf', size: 11 * 1024 * 1024, type: '' });
    expect(!big.ok && big.status).toBe(413);
    const exe = validateEvidenceFile({ name: 'run.exe', size: 10, type: '' });
    expect(!exe.ok && exe.status).toBe(415);
    const spoof = validateEvidenceFile({ name: 'p.pdf', size: 10, type: 'text/html' });
    expect(!spoof.ok && spoof.status).toBe(415);
    expect(validateEvidenceFile({ name: 'p.pdf', size: 0, type: '' }).ok).toBe(false);
  });

  it('принимает только ключи вложений своей проверки', () => {
    const prefix = evidenceKeyPrefix('p1', 'c1');
    const ok = parseEvidenceRefs([{ key: `${prefix}a.pdf`, name: 'a.pdf' }], 'p1', 'c1');
    expect(ok.ok).toBe(true);
    for (const key of [
      'acceptance/p1/c2/a.pdf',
      `${prefix}../c2/a.pdf`,
      `${prefix}x/a.pdf`,
      'p1/p1.zip',
    ]) {
      expect(parseEvidenceRefs([{ key }], 'p1', 'c1').ok, key).toBe(false);
    }
    expect(
      parseEvidenceRefs([{ key: `${prefix}a.pdf` }, { key: `${prefix}a.pdf` }], 'p1', 'c1').ok,
    ).toBe(false);
    expect(parseEvidenceRefs(undefined, 'p1', 'c1')).toEqual({ ok: true, value: [] });
  });
});
