import { describe, it, expect } from 'vitest';
import { buildPZ34Sections } from '../pz34';
import { buildAF34Sections } from '../af34';
import { buildPMI34Sections } from '../pmi34';
import { buildSPEC34Sections } from '../spec34';
import { Gost34InputPayload } from '../../types';
import { GOST34_2020_PROFILE, GOST34_LEGACY_PROFILE } from '../../standards/profiles';

describe('Modern Document Generators (PZ, AF, PMI, SPEC)', () => {
  const mockPayload: Gost34InputPayload = {
    metadata: {
      docType: 'PZ',
      systemName: 'ФинСистема',
      fullSystemName: 'Информационная система ФинСистема',
      documentCode: 'АБВГ.123456.002 ПЗ',
      customerName: 'ПАО Банк',
      developerName: 'ООО ФинСофт',
      signatures: {
        developer: 'Иванов И.И.',
        checker: 'Петров П.П.',
        techControl: 'Сидоров С.С.',
        normControl: 'Кузнецов К.К.',
        approver: 'Васильев В.В.',
      },
      city: 'Москва',
      year: 2026,
      version: '1.0',
    },
    standardProfile: GOST34_2020_PROFILE,
    systemName: 'ФинСистема',
    customerName: 'ПАО Банк',
    stages: [{ id: 's1', order: 1, name: 'Разработка БД', role: 'Архитектор', hours: 40 }],
    customRequirements: [
      { id: 'r1', code: 'ТР-01', category: 'security', title: 'Авторизация', description: 'Двухфакторная авторизация' },
    ],
    projectContext: {
      architecture: {
        style: 'Микросервисная архитектура',
        components: ['React SPA Frontend', 'Go Microservices', 'PostgreSQL Cluster'],
      },
      infrastructure: {
        platforms: ['Astra Linux SE', 'PostgreSQL 15', 'Nginx'],
        computeResources: '8 vCPU, 16 ГБ RAM',
        storage: '500 ГБ NVMe',
      },
      availability: {
        availabilityTargetPercent: 99.95,
        rtoMinutes: 30,
        rpoMinutes: 5,
      },
    },
  };

  it('buildPZ34Sections generates correct sections using projectContext and standardProfile', () => {
    const sections = buildPZ34Sections(mockPayload);
    expect(sections.length).toBeGreaterThanOrEqual(5);

    const sec1 = sections.find((s) => s.id === 'sec-1');
    expect(sec1?.paragraphs[4]).toContain('ГОСТ Р 59795-2021');

    const sec3 = sections.find((s) => s.id === 'sec-3');
    expect(sec3?.paragraphs[0]).toContain('Микросервисная архитектура');
    expect(sec3?.paragraphs[1]).toContain('PostgreSQL Cluster');
  });

  it('buildPZ34Sections falls back gracefully when standardProfile is legacy', () => {
    const legacyPayload = {
      ...mockPayload,
      standardProfile: GOST34_LEGACY_PROFILE,
    };
    const sections = buildPZ34Sections(legacyPayload);
    const sec1 = sections.find((s) => s.id === 'sec-1');
    expect(sec1?.paragraphs[4]).toContain('РД 50-34.698-90');
  });

  it('buildAF34Sections generates functional specification', () => {
    const sections = buildAF34Sections(mockPayload);
    expect(sections).toHaveLength(3);
    const table = sections[1].tables?.[0];
    expect(table?.rows[0][0]).toBe('ТР-01');
    expect(table?.rows[0][3]).toBe('Двухфакторная авторизация');
  });

  it('buildPMI34Sections includes testing citations and verification criteria', () => {
    const sections = buildPMI34Sections(mockPayload);
    expect(sections).toHaveLength(5);
    const sec1 = sections.find((s) => s.id === 'sec-1');
    expect(sec1?.paragraphs[1]).toContain('ГОСТ Р 59792-2021');
  });

  it('buildSPEC34Sections formats software & hardware specs from projectContext', () => {
    const sections = buildSPEC34Sections(mockPayload);
    expect(sections).toHaveLength(4);

    const swTable = sections[1].tables?.[0];
    expect(swTable?.rows[0][1]).toContain('Astra Linux SE');
    expect(swTable?.rows[1][1]).toContain('PostgreSQL 15');

    const hwTable = sections[2].tables?.[0];
    expect(hwTable?.rows[0][2]).toContain('8 vCPU');
    expect(hwTable?.rows[1][2]).toContain('500 ГБ');
  });
});
