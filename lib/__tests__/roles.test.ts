import { describe, expect, it } from 'vitest';
import { normalizeRoleKey, canonicalRole, APPROVAL_REQUIRED_ROLES, ROLES } from '../roles';
import { calculateCommercialSummary, DEFAULT_ROLE_RATES } from '../commercial';

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

  it('не принимает подстроку за синоним платной роли', () => {
    expect(normalizeRoleKey('software engineering')).toBe('other');
    expect(normalizeRoleKey('engineering manager')).toBe('other');
  });

  it('каноническую роль узнаёт без синонимов', () => {
    expect(canonicalRole('engineer')).toBe('engineer');
    expect(canonicalRole(' Engineer ')).toBe('engineer');
    expect(normalizeRoleKey('engineer')).toBe('engineer');
    expect(canonicalRole('software engineer')).toBeNull();
    expect(canonicalRole('неизвестная роль')).toBeNull();
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

  it('неизвестную роль тарифицирует по ставке other, а не developer', () => {
    const summary = calculateCommercialSummary([{ hours: 10, role: 'неизвестная роль' }], 0, [], {
      roleRates: { developer: 3500 },
    });

    const other = summary.rolesBreakdown.find((r) => r.role === 'other');
    expect(other).toBeDefined();
    expect(other?.hours).toBe(10);
    expect(other?.rate).toBe(DEFAULT_ROLE_RATES.other);
    expect(other?.cost).toBe(10 * DEFAULT_ROLE_RATES.other);
    expect(summary.rolesBreakdown.find((r) => r.role === 'developer')).toBeUndefined();
  });

  it('каноническую роль берёт из ставок, даже если синоним другой', () => {
    const summary = calculateCommercialSummary([{ hours: 4, role: 'engineer' }], 0, [], {
      roleRates: { engineer: 2000, developer: 3500 },
    });
    const row = summary.rolesBreakdown.find((r) => r.role === 'engineer');
    expect(row?.cost).toBe(8000);
  });

  it('точный ключ ставки побеждает нормализацию', () => {
    const summary = calculateCommercialSummary([{ hours: 2, role: 'внешняя ставка' }], 0, [], {
      roleRates: { 'внешняя ставка': 1000 },
    });
    const row = summary.rolesBreakdown.find((r) => r.role === 'внешняя ставка');
    expect(row?.cost).toBe(2000);
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
