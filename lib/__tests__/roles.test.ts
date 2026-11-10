import { describe, expect, it } from 'vitest';
import { normalizeRoleKey, APPROVAL_REQUIRED_ROLES, ROLES } from '../roles';
import { calculateCommercialSummary } from '../commercial';

describe('Нормализация ролей (normalizeRoleKey)', () => {
  it('корректно отображает популярные синонимы в канонические роли', () => {
    expect(normalizeRoleKey('software engineer')).toBe('developer');
    expect(normalizeRoleKey('программист')).toBe('developer');
    expect(normalizeRoleKey('Frontend Developer')).toBe('developer');
    expect(normalizeRoleKey('техлид')).toBe('architect');
    expect(normalizeRoleKey('эксперт')).toBe('consultant');
    expect(normalizeRoleKey('DevOps')).toBe('engineer');
    expect(normalizeRoleKey('системный аналитик')).toBe('analyst');
    expect(normalizeRoleKey('менеджер проекта')).toBe('pm');
    expect(normalizeRoleKey('Заказчик')).toBe('customer');
  });

  it('возвращает other для пустой или неизвестной роли', () => {
    expect(normalizeRoleKey('')).toBe('other');
    expect(normalizeRoleKey('дизайнер')).toBe('other');
    expect(normalizeRoleKey('маркетолог')).toBe('other');
  });

  it('тарифицирует неканонические роли через нормализованный ключ в смете', () => {
    const summary = calculateCommercialSummary([{ hours: 10, role: 'software engineer' }], 0, [], {
      roleRates: { developer: 3500 },
    });

    const devBreakdown = summary.rolesBreakdown.find((r) => r.role === 'developer');
    expect(devBreakdown).toBeDefined();
    expect(devBreakdown?.hours).toBe(10);
    expect(devBreakdown?.cost).toBe(35000);
  });
});

describe('Требование согласования (APPROVAL_REQUIRED_ROLES)', () => {
  it('содержит производственные роли, выполняющие прямые работы', () => {
    expect(APPROVAL_REQUIRED_ROLES).toEqual(['consultant', 'developer', 'engineer', 'analyst']);
  });

  it('не требует согласования от ролей управления, архитектуры и заказчика', () => {
    expect(APPROVAL_REQUIRED_ROLES.includes('architect')).toBe(false);
    expect(APPROVAL_REQUIRED_ROLES.includes('pm')).toBe(false);
    expect(APPROVAL_REQUIRED_ROLES.includes('customer')).toBe(false);
    expect(APPROVAL_REQUIRED_ROLES.includes('other')).toBe(false);
  });
});
