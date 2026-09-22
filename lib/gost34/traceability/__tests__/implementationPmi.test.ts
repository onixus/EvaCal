import { describe, expect, it } from 'vitest';
import { implementationProfileOf, resolvePmiTest } from '../matrix';

describe('ПМИ специализированных внедрений', () => {
  it('узнаёт профиль по префиксу кода требования', () => {
    expect(implementationProfileOf('ТР-SIEM-01')).toBe('SIEM');
    expect(implementationProfileOf('ТР-IDM-04')).toBe('IDM');
    expect(implementationProfileOf('ТР-NGFW-02')).toBe('NGFW');
    expect(implementationProfileOf('ТР-ИБ-01')).toBeNull();
    expect(implementationProfileOf('')).toBeNull();
  });

  it('выдаёт профильную методику требованиям пресейл-sizing', () => {
    const pmi = resolvePmiTest(
      {
        code: 'ТР-NGFW-02',
        title: 'Сегментация и политики межсетевого экранирования',
        category: 'security',
      },
      2,
    );

    expect(pmi.testCode).toBe('ПМИ-NGFW-02');
    expect(pmi.method).toContain('HA-кластера');
  });

  it('оставляет комбинированное требование ИБ в общей методике, а не в NGFW', () => {
    // «Фильтрация трафика NGFW UserGate и антивирусная защита Kaspersky»:
    // текст упоминает NGFW, но проверять надо весь контур СЗИ целиком.
    const pmi = resolvePmiTest(
      {
        code: 'ТР-ИБ-01',
        title: 'Межсетевое экранирование UserGate и защита конечных точек Kaspersky',
        description:
          'Система должна обеспечивать фильтрацию трафика NGFW UserGate и антивирусную защиту Kaspersky Endpoint Security по требованиям ФСТЭК № 21.',
        category: 'security',
      },
      3,
    );

    expect(pmi.testCode).toContain('ИБ');
    expect(pmi.testCode).not.toContain('NGFW');
    expect(pmi.method).toContain('сканирование сетевых портов');
  });
});
