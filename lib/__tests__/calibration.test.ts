import { describe, expect, it } from 'vitest';
import {
  buildCalibration,
  comparableFields,
  durationDays,
  fieldCloseness,
  formulaBreakdown,
  type CalibrationCalcRow,
  type CalibrationField,
  type CalibrationStageTemplate,
} from '@/lib/calibration';

const fields: CalibrationField[] = [
  { key: 'servers', label: 'Серверов', type: 'number', options: null },
  { key: 'complexity', label: 'Сложность', type: 'complexity', options: null },
  { key: 'ha', label: 'Кластер HA', type: 'checkbox', options: null },
  { key: 'os', label: 'ОС', type: 'select', options: JSON.stringify(['Astra', 'РЕД ОС']) },
  { key: 'notes', label: 'Примечания', type: 'textarea', options: null },
];

const stageTemplates: CalibrationStageTemplate[] = [
  {
    name: 'Обследование',
    role: 'analyst',
    baseHours: 16,
    hoursPerUnit: 0,
    driverFieldKey: null,
    order: 0,
  },
  {
    name: 'Внедрение',
    role: 'engineer',
    baseHours: 8,
    hoursPerUnit: 4,
    driverFieldKey: 'servers',
    order: 1,
  },
];

const day = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-03-01T00:00:00Z');

function stage(name: string, hours: number, startDay: number, endDay: number) {
  return {
    name,
    hours,
    isApprovalTask: false,
    startDate: new Date(t0.getTime() + startDay * day),
    endDate: new Date(t0.getTime() + endDay * day),
  };
}

/** Утверждённый расчёт, у которого архитектор умножил «Внедрение» на factor и добавил риски. */
function approved(
  id: string,
  answers: Record<string, unknown>,
  factor: number,
  opts: { projectId?: string | null; riskHours?: number; status?: string; days?: number } = {},
): CalibrationCalcRow {
  const f = formulaBreakdown(stageTemplates, fields, answers);
  const impl = f.stages[1].hours * factor;
  return {
    id,
    name: `Проект ${id}`,
    customer: `Заказчик ${id}`,
    projectId: opts.projectId ?? `prj-${id}`,
    version: 1,
    status: opts.status ?? 'approved',
    answers,
    pmHours: f.pmHours,
    stages: [stage('Обследование', 16, 0, 5), stage('Внедрение', impl, 5, opts.days ?? 20)],
    risks: opts.riskHours ? [{ hours: opts.riskHours }] : [],
    updatedAt: new Date('2026-04-01T00:00:00Z'),
  };
}

const targetAnswers = { servers: 10, complexity: 'Средний', ha: true, os: 'Astra', notes: 'x' };

function target(overrides: Partial<CalibrationCalcRow> = {}): CalibrationCalcRow {
  const f = formulaBreakdown(stageTemplates, fields, targetAnswers);
  return {
    id: 'target',
    name: 'Целевой',
    customer: 'Банк',
    projectId: 'prj-target',
    version: 1,
    status: 'draft',
    answers: targetAnswers,
    pmHours: f.pmHours,
    stages: [stage('Обследование', 16, 0, 5), stage('Внедрение', f.stages[1].hours, 5, 20)],
    risks: [],
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('lib/calibration — формула и похожесть', () => {
  it('formulaBreakdown повторяет формулу шаблона и надбавку РП', () => {
    const f = formulaBreakdown(stageTemplates, fields, targetAnswers);
    expect(f.stages).toEqual([
      { name: 'Обследование', hours: 16 },
      { name: 'Внедрение', hours: 48 },
    ]);
    // 16 + 20% от 64
    expect(f.pmHours).toBe(28.8);
    expect(f.total).toBe(92.8);
  });

  it('свободный текст не участвует в сравнении', () => {
    expect(comparableFields(fields).map((f) => f.key)).toEqual([
      'servers',
      'complexity',
      'ha',
      'os',
    ]);
  });

  it('сложность — порядковая: соседние уровни ближе крайних', () => {
    const scale = { field: fields[1], range: 0, options: ['Простой', 'Средний', 'Сложный'] };
    expect(fieldCloseness(scale, 'Простой', 'Средний')).toBe(0.5);
    expect(fieldCloseness(scale, 'Простой', 'Сложный')).toBe(0);
    expect(fieldCloseness(scale, 'Средний', 'Средний')).toBe(1);
  });

  it('число сравнивается по размаху пула, пустое против заполненного — 0, оба пустые — не считается', () => {
    const scale = { field: fields[0], range: 20, options: [] };
    expect(fieldCloseness(scale, 10, 15)).toBe(0.75);
    expect(fieldCloseness(scale, 10, undefined)).toBe(0);
    expect(fieldCloseness(scale, '', null)).toBeNull();
  });

  it('durationDays берёт размах от первого старта до последнего конца', () => {
    expect(durationDays([stage('a', 1, 0, 5), stage('b', 1, 3, 20)])).toBe(20);
    expect(durationDays([])).toBe(0);
  });
});

describe('lib/calibration — отчёт', () => {
  it('без утверждённых расчётов отдаёт пустой отчёт с уверенностью none', () => {
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates: [],
      revealIdentity: true,
    });
    expect(r.neighbours).toEqual([]);
    expect(r.confidence).toBe('none');
    expect(r.calibratedHours).toBeNull();
    expect(r.target.formulaHours).toBe(92.8);
    expect(r.target.currentRatio).toBe(1);
  });

  it('исключает сам расчёт, чужие статусы и версии из того же проекта', () => {
    const candidates = [
      target({ id: 'target', status: 'approved' }),
      approved('same-project', targetAnswers, 1.5, { projectId: 'prj-target' }),
      approved('pending', targetAnswers, 1.5, { status: 'pending_approval' }),
      approved('ok', targetAnswers, 1.5),
    ];
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates,
      revealIdentity: true,
    });
    expect(r.poolSize).toBe(1);
    expect(r.neighbours.map((n) => n.id)).toEqual(['ok']);
  });

  it('исключает свои версии, когда расчёт не привязан к проекту', () => {
    // projectId === null у всех: отсечение по проекту здесь не работает вовсе,
    // и собственные утверждённые версии должны отсекаться по цепочке версий.
    const candidates = [
      approved('v1', targetAnswers, 1.9, { projectId: null }),
      approved('v2', targetAnswers, 1.9, { projectId: null }),
      approved('чужой', targetAnswers, 1.2, { projectId: null }),
    ];
    const r = buildCalibration({
      target: target({ projectId: null }),
      fields,
      stageTemplates,
      candidates,
      revealIdentity: true,
      lineageIds: ['target', 'v1', 'v2'],
    });
    expect(r.poolSize).toBe(1);
    expect(r.neighbours.map((n) => n.id)).toEqual(['чужой']);
  });

  it('обнулённый этап входит в медиану, отсутствующий — нет', () => {
    const withZeroed = approved('zeroed', targetAnswers, 1);
    // Этап оставлен в плане, но обнулён: архитектор сказал «столько и нужно».
    withZeroed.stages = [stage('Обследование', 16, 0, 5), stage('Внедрение', 0, 5, 20)];

    const withMissing = approved('missing', targetAnswers, 1);
    // Этапа нет вовсе — отличить удаление от переименования нельзя.
    withMissing.stages = [stage('Обследование', 16, 0, 5)];

    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates: [withZeroed, withMissing],
      revealIdentity: true,
    });

    const impl = r.stageAdjustments.find((a) => a.name === 'Внедрение');
    expect(impl).toBeDefined();
    // Одно наблюдение из двух соседей, и оно нулевое.
    expect(impl!.samples).toBe(1);
    expect(impl!.medianRatio).toBe(0);
    expect(impl!.suggestedHours).toBe(0);
  });

  it('ранжирует соседей по похожести и отбрасывает непохожие', () => {
    const candidates = [
      approved('far', { servers: 200, complexity: 'Сложный', ha: false, os: 'РЕД ОС' }, 1),
      approved('near', { servers: 12, complexity: 'Сложный', ha: true, os: 'Astra' }, 1),
      approved('exact', targetAnswers, 1),
    ];
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates,
      revealIdentity: true,
    });
    expect(r.neighbours.map((n) => n.id)).toEqual(['exact', 'near']);
    expect(r.neighbours[0].similarity).toBe(1);
    expect(r.neighbours[1].similarity).toBeLessThan(1);
  });

  it('считает медианный коэффициент, диапазон и калиброванную оценку', () => {
    const candidates = [
      approved('a', targetAnswers, 1.0),
      approved('b', targetAnswers, 1.5, { riskHours: 20 }),
      approved('c', targetAnswers, 2.0),
    ];
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates,
      revealIdentity: true,
    });
    expect(r.neighbours).toHaveLength(3);
    // a: 92.8 / 92.8 = 1; b: (16+72+28.8+20)/92.8 = 1.47; c: (16+96+28.8)/92.8 = 1.52
    expect(r.neighbours.find((n) => n.id === 'a')?.ratio).toBe(1);
    expect(r.medianRatio).toBe(1.47);
    expect(r.ratioRange).toEqual({ min: 1, max: 1.52 });
    expect(r.calibratedHours).toBe(136.4);
    expect(r.calibratedRange).toEqual({ min: 92.8, max: 141.1 });
    expect(r.medianDurationDays).toBe(20);
    expect(r.confidence).toBe('high');
  });

  it('поэтапная поправка: медиана по имени этапа, нетронутые этапы дают ×1', () => {
    const candidates = [
      approved('a', targetAnswers, 1.0),
      approved('b', targetAnswers, 1.5),
      approved('c', targetAnswers, 2.0),
    ];
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates,
      revealIdentity: true,
    });
    const impl = r.stageAdjustments.find((s) => s.name === 'Внедрение');
    const survey = r.stageAdjustments.find((s) => s.name === 'Обследование');
    expect(impl).toMatchObject({
      targetFormulaHours: 48,
      medianRatio: 1.5,
      samples: 3,
      suggestedHours: 72,
    });
    expect(survey).toMatchObject({ medianRatio: 1, suggestedHours: 16 });
  });

  it('низкая уверенность при малой выборке', () => {
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates: [approved('a', targetAnswers, 1.2)],
      revealIdentity: true,
    });
    expect(r.confidence).toBe('low');
  });

  it('обезличивает соседей для гостей', () => {
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates: [approved('a', targetAnswers, 1.2)],
      revealIdentity: false,
    });
    expect(r.neighbours[0].label).toBe('Похожий проект №1');
    expect(r.neighbours[0].customer).toBeNull();
    // Ответы соседа всё равно видны — это обезличенные параметры опросника.
    expect(r.neighbours[0].answers.length).toBeGreaterThan(0);
  });

  it('ограничивает число соседей параметром k', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      approved(`n${i}`, targetAnswers, 1 + i / 10),
    );
    const r = buildCalibration({
      target: target(),
      fields,
      stageTemplates,
      candidates,
      revealIdentity: true,
      k: 4,
    });
    expect(r.neighbours).toHaveLength(4);
    expect(r.poolSize).toBe(8);
  });
});
