import { describe, expect, it } from 'vitest';
import {
  APP_ROLES,
  appRoleLabel,
  defaultReviewStageFor,
  hasArchitectPowers,
  hasReviewerPowers,
  isAppRole,
  isGapRole,
  isTechWriterRole,
  reviewStagesFor,
  NAV_BY_ROLE,
  ROLE_HOME,
  type AppRole,
} from '../appRoles';
import { canDecideReviewStage, REVIEW_STAGE_ROLES } from '../gost34/review/types';

const ALL_ROLES: AppRole[] = ['presale', 'architect', 'techwriter', 'gap', 'reviewer', 'admin'];

describe('Ролевая модель платформы', () => {
  it('содержит шесть ролей, включая тех.писателя и ГАПа', () => {
    expect(APP_ROLES.map((r) => r.value)).toEqual(ALL_ROLES);
    expect(appRoleLabel('techwriter')).toBe('Технический писатель');
    expect(appRoleLabel('gap')).toBe('ГАП (главный архитектор проекта)');
  });

  it('у каждой роли есть стартовый экран и своя навигация', () => {
    for (const role of ALL_ROLES) {
      expect(isAppRole(role)).toBe(true);
      expect(ROLE_HOME[role]).toMatch(/^\//);
      expect(NAV_BY_ROLE[role].length).toBeGreaterThan(0);
    }
  });

  it('незнакомая роль не считается ролью платформы', () => {
    expect(isAppRole('normocontrol')).toBe(false);
    expect(appRoleLabel(null)).toBe('Гость');
  });
});

describe('Разделение подписей под комплектом', () => {
  it('нормоконтроль подписывает только тех.писатель (и админ)', () => {
    expect(REVIEW_STAGE_ROLES.tw).toEqual(['techwriter', 'admin']);
    expect(canDecideReviewStage('techwriter', 'tw')).toBe(true);
    expect(canDecideReviewStage('admin', 'tw')).toBe(true);
    for (const role of ['architect', 'gap', 'reviewer', 'presale']) {
      expect(canDecideReviewStage(role, 'tw')).toBe(false);
    }
  });

  it('выпуск утверждает только ГАП (и админ)', () => {
    expect(REVIEW_STAGE_ROLES.gap).toEqual(['gap', 'admin']);
    expect(canDecideReviewStage('gap', 'gap')).toBe(true);
    expect(canDecideReviewStage('admin', 'gap')).toBe(true);
    for (const role of ['architect', 'techwriter', 'reviewer', 'presale']) {
      expect(canDecideReviewStage(role, 'gap')).toBe(false);
    }
  });

  it('на завершённом комплекте решения не выносит никто', () => {
    for (const role of ALL_ROLES) {
      expect(canDecideReviewStage(role, 'done')).toBe(false);
    }
  });

  it('архитектор выпускает комплект, но не подписывает его', () => {
    expect(hasArchitectPowers('architect')).toBe(true);
    expect(canDecideReviewStage('architect', 'gap')).toBe(false);
    expect(hasArchitectPowers('gap')).toBe(false);
  });

  it('рецензент допущен к экранам ревью, но вердикта не выносит', () => {
    expect(hasReviewerPowers('reviewer')).toBe(true);
    expect(canDecideReviewStage('reviewer', 'tw')).toBe(false);
    expect(canDecideReviewStage('reviewer', 'gap')).toBe(false);
  });

  it('пресейл к экранам ревью не допущен', () => {
    expect(hasReviewerPowers('presale')).toBe(false);
  });
});

describe('Очередь по умолчанию на экране ревью', () => {
  it('тех.писатель и рецензент попадают на нормоконтроль', () => {
    expect(isTechWriterRole('techwriter')).toBe(true);
    expect(isTechWriterRole('reviewer')).toBe(true);
    expect(defaultReviewStageFor('techwriter')).toBe('tw');
    expect(defaultReviewStageFor('reviewer')).toBe('tw');
  });

  it('ГАП, архитектор и админ — на финальное ревью', () => {
    expect(isGapRole('gap')).toBe(true);
    expect(isGapRole('architect')).toBe(true);
    expect(isGapRole('admin')).toBe(true);
    expect(defaultReviewStageFor('gap')).toBe('gap');
    expect(defaultReviewStageFor('architect')).toBe('gap');
    // Админ — надмножество всех ролей: видит обе очереди, по умолчанию открывает ГАП.
    expect(isTechWriterRole('admin')).toBe(true);
    expect(defaultReviewStageFor('admin')).toBe('gap');
    expect(reviewStagesFor('admin')).toEqual(['tw', 'gap']);
    expect(reviewStagesFor('techwriter')).toEqual(['tw']);
    expect(reviewStagesFor('architect')).toEqual(['gap']);
  });
});
