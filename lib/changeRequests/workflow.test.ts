import { describe, expect, it } from 'vitest';
import { CHANGE_REQUEST_STATUSES } from './types';
import {
  CHANGE_REQUEST_TRANSITIONS,
  ChangeRequestError,
  canDecideChangeRequests,
  canEditChangeRequests,
  canEditContent,
  canEstimate,
  canEstimateChangeRequests,
  canSubmit,
  decisionError,
  estimateOnReopen,
  formatChangeLabel,
  formatChangeRequestNumber,
  isDecision,
  parseDecisionComment,
  parseDraftInput,
  parseEstimateInput,
  transitionError,
} from './workflow';

const draft = {
  title: 'Добавить SSO',
  initiator: 'Заказчик, ИТ-директор',
  reason: 'Требование ИБ',
  baseCalculationId: 'c1',
  basePackageId: 'p1',
  requirementIds: ['R1', 'R1', 'R2'],
  proposedChanges: {
    summary: 'Вход через корпоративный SSO',
    items: [
      { kind: 'modify', requirementId: 'R1', text: 'Вход через SAML' },
      { kind: 'add', requirementId: 'R9', text: 'Журнал входов SSO' },
      { kind: 'remove', requirementId: 'R2' },
    ],
  },
};

describe('переходы статусов', () => {
  it('черновик → на оценку; решения — только из «на оценке»', () => {
    expect(transitionError('draft', 'submitted', { hasEstimate: false })).toBeNull();
    expect(transitionError('draft', 'accepted', { hasEstimate: true })).not.toBeNull();
    expect(transitionError('submitted', 'rejected', { hasEstimate: false })).toBeNull();
    expect(transitionError('submitted', 'deferred', { hasEstimate: false })).toBeNull();
    expect(transitionError('deferred', 'submitted', { hasEstimate: false })).toBeNull();
    expect(transitionError('submitted', 'draft', { hasEstimate: false })).not.toBeNull();
  });
  it('принять можно только с оценкой', () => {
    expect(transitionError('submitted', 'accepted', { hasEstimate: false })).toMatch(/оценк/);
    expect(transitionError('submitted', 'accepted', { hasEstimate: true })).toBeNull();
  });
  it('принятый и отклонённый — конечные', () => {
    for (const to of CHANGE_REQUEST_STATUSES) {
      expect(transitionError('accepted', to, { hasEstimate: true })).not.toBeNull();
      expect(transitionError('rejected', to, { hasEstimate: true })).not.toBeNull();
    }
    expect(Object.keys(CHANGE_REQUEST_TRANSITIONS).sort()).toEqual(
      [...CHANGE_REQUEST_STATUSES].sort(),
    );
  });
  it('правка — только черновик, оценка — только на оценке', () => {
    expect(CHANGE_REQUEST_STATUSES.filter(canEditContent)).toEqual(['draft']);
    expect(CHANGE_REQUEST_STATUSES.filter(canEstimate)).toEqual(['submitted']);
  });
});

describe('роли', () => {
  it('вести запрос — пресейл/архитектор/админ, оценивать — архитектор/админ', () => {
    expect(['presale', 'architect', 'admin'].every(canEditChangeRequests)).toBe(true);
    expect(['techwriter', 'gap', 'reviewer', null].some(canEditChangeRequests)).toBe(false);
    expect(canEstimateChangeRequests('presale')).toBe(false);
    expect(canEstimateChangeRequests('architect')).toBe(true);
  });
});

describe('parseDraftInput', () => {
  it('нормализует черновик: дубликаты требований, новое требование без ссылки', () => {
    const parsed = parseDraftInput(draft);
    expect(parsed.requirementIds).toEqual(['R1', 'R2']);
    expect(parsed.proposedChanges.items).toEqual([
      { kind: 'modify', requirementId: 'R1', text: 'Вход через SAML' },
      { kind: 'add', requirementId: null, text: 'Журнал входов SSO' },
      { kind: 'remove', requirementId: 'R2', text: '' },
    ]);
  });
  it.each([
    [{ ...draft, title: ' ' }, /Название/],
    [{ ...draft, reason: undefined }, /Причина/],
    [{ ...draft, initiator: 'x'.repeat(201) }, /Инициатор/],
    [{ ...draft, baseCalculationId: '' }, /базовую версию/],
    [{ ...draft, requirementIds: [1] }, /требований/],
    [{ ...draft, proposedChanges: { items: [{ kind: 'modify', text: 'x' }] } }, /требование/],
    [{ ...draft, proposedChanges: { items: [{ kind: 'drop', text: 'x' }] } }, /вид/],
  ])('отклоняет некорректный черновик %#', (body, message) => {
    expect(() => parseDraftInput(body)).toThrow(message);
  });
});

describe('parseEstimateInput — оценку вводят явно', () => {
  it('принимает часы, стоимость и срок, в том числе сокращение объёма', () => {
    expect(parseEstimateInput({ hours: 16.5, cost: '42000.50', scheduleDays: 3 })).toEqual({
      hours: 16.5,
      cost: '42000.50',
      scheduleDays: 3,
      comment: null,
    });
    expect(parseEstimateInput({ hours: -8, cost: -10000, scheduleDays: -1 }).cost).toBe('-10000');
    expect(parseEstimateInput({ hours: 0, cost: '0', scheduleDays: 0 }).hours).toBe(0);
  });
  it.each([
    [{ cost: '1', scheduleDays: 1 }],
    [{ hours: '8', cost: '1', scheduleDays: 1 }],
    [{ hours: Number.NaN, cost: '1', scheduleDays: 1 }],
    [{ hours: 8, scheduleDays: 1 }],
    [{ hours: 8, cost: '1.234', scheduleDays: 1 }],
    [{ hours: 8, cost: '1e5', scheduleDays: 1 }],
    [{ hours: 8, cost: '1' }],
    [{ hours: 8, cost: '1', scheduleDays: 1.5 }],
    [null],
  ])('без явного значения оценки нет: %j', (body) => {
    expect(() => parseEstimateInput(body)).toThrow(ChangeRequestError);
  });
});

it('номер запроса', () => {
  expect(formatChangeRequestNumber(3)).toBe('ЗИ-03');
  expect(formatChangeRequestNumber(120)).toBe('ЗИ-120');
});

describe('решения (WP-2b)', () => {
  it('принять/отклонить/отложить — из «на оценке», вернуть — из «отложен»', () => {
    const ok = { hasEstimate: true, estimateMatchesBase: true };
    expect(decisionError('accept', 'submitted', ok)).toBeNull();
    expect(decisionError('reject', 'submitted', ok)).toBeNull();
    expect(decisionError('defer', 'submitted', ok)).toBeNull();
    expect(decisionError('reopen', 'deferred', ok)).toBeNull();
    expect(decisionError('accept', 'draft', ok)).not.toBeNull();
    expect(decisionError('accept', 'deferred', ok)).not.toBeNull();
    expect(decisionError('reopen', 'submitted', ok)).not.toBeNull();
    expect(decisionError('reopen', 'rejected', ok)).not.toBeNull();
    expect(decisionError('reject', 'accepted', ok)).not.toBeNull();
  });
  it('принятие требует оценки, сделанной по текущей базе', () => {
    expect(decisionError('accept', 'submitted', { hasEstimate: false })).toMatch(/оценк/);
    expect(
      decisionError('accept', 'submitted', { hasEstimate: true, estimateMatchesBase: false }),
    ).toMatch(/переоцен/);
    // отклонить можно и без оценки
    expect(decisionError('reject', 'submitted', { hasEstimate: false })).toBeNull();
  });
  it('причина обязательна для «отклонить» и «отложить»', () => {
    expect(() => parseDecisionComment('reject', '  ')).toThrow(/причину/);
    expect(() => parseDecisionComment('defer', undefined)).toThrow(/причину/);
    expect(parseDecisionComment('accept', undefined)).toBeNull();
    expect(parseDecisionComment('reopen', ' ок ')).toBe('ок');
  });
  it('политика оценки при возврате', () => {
    expect(estimateOnReopen(false, false)).toBe('none');
    expect(estimateOnReopen(true, true)).toBe('keep');
    expect(estimateOnReopen(true, false)).toBe('clear');
  });
  it('передать можно только черновик; решения — архитектор/админ', () => {
    expect(CHANGE_REQUEST_STATUSES.filter(canSubmit)).toEqual(['draft']);
    expect(['architect', 'admin'].every(canDecideChangeRequests)).toBe(true);
    expect(['presale', 'gap', null].some(canDecideChangeRequests)).toBe(false);
    expect(isDecision('accept')).toBe(true);
    expect(isDecision('submit')).toBe(false);
    expect(formatChangeLabel(7)).toBe('ИЗМ-07');
  });
});
