import { describe, it, expect } from 'vitest';
import {
  GOST34_TOR_TEMPLATES,
  listTorTemplates,
  getTorTemplateById,
  getTorTemplatesByCategory,
  applyTorTemplate,
} from '../index';
import { validateRequirements } from '../../validation';
import { fromGost34RequirementItems } from '../../requirements';

describe('GOST 34 TOR Templates Library', () => {
  it('предоставляет все 7 детализированных отраслевых шаблонов ТЗ', () => {
    const templates = listTorTemplates();
    expect(templates).toHaveLength(7);
    expect(templates.map((t) => t.id)).toEqual([
      'tor-custom-web-microservices',
      'tor-erp-crm-enterprise',
      'tor-fintech-banking',
      'tor-gis-kii-fstek',
      'tor-data-lake-bi',
      'tor-siem-soc-monitoring',
      'tor-infrastructure-pac-db',
    ]);
  });

  it('каждый шаблон содержит полноценный детализированный состав требований (от 10 до 20 пунктов)', () => {
    for (const template of GOST34_TOR_TEMPLATES) {
      expect(template.requirements.length, `${template.id} должен содержать от 10 требований`).toBeGreaterThanOrEqual(10);
      expect(template.name.length).toBeGreaterThan(10);
      expect(template.description.length).toBeGreaterThan(30);

      for (const req of template.requirements) {
        expect(req.code).toMatch(/^ТР-[А-ЯЁ]{3}-\d{2}$/);
        expect(req.title.trim().length).toBeGreaterThan(5);
        expect(req.description.trim().length).toBeGreaterThan(20);
        // Требования должны содержать нормативное предписание («должен», «должна», «следует»)
        expect(req.description.toLowerCase()).toMatch(/должен|должн|следует/);
      }
    }
  });

  it('все требования шаблонов проходят валидацию ГОСТ 34 без ошибок (0 ERROR)', () => {
    for (const template of GOST34_TOR_TEMPLATES) {
      const v2Items = fromGost34RequirementItems(template.requirements);
      const validation = validateRequirements(v2Items);

      const errors = validation.findings.filter((f) => f.severity === 'ERROR');
      expect(
        errors,
        `Шаблон ${template.id} не должен содержать критических ошибок формулировок: ${JSON.stringify(errors)}`,
      ).toHaveLength(0);
    }
  });

  it('находит шаблон по идентификатору и категории', () => {
    const template = getTorTemplateById('tor-fintech-banking');
    expect(template).toBeDefined();
    expect(template?.shortName).toContain('FinTech');

    const fintechTemplates = getTorTemplatesByCategory('fintech');
    expect(fintechTemplates).toHaveLength(1);
    expect(fintechTemplates[0].id).toBe('tor-fintech-banking');
  });

  it('корректно применяет шаблон в режиме замены (replace)', () => {
    const template = getTorTemplateById('tor-custom-web-microservices')!;
    const existing = [
      {
        id: 'old-1',
        code: 'ТР-СТАР-01',
        category: 'functional' as const,
        title: 'Старое требование',
        description: 'Старое описание.',
      },
    ];

    const result = applyTorTemplate({
      template,
      currentRequirements: existing,
      mode: 'replace',
    });

    expect(result).toHaveLength(template.requirements.length);
    expect(result.some((r) => r.code === 'ТР-СТАР-01')).toBe(false);
    expect(result[0].code).toBe(template.requirements[0].code);
  });

  it('корректно добавляет требования в режиме дополнения (append) с предотвращением коллизий кодов', () => {
    const template = getTorTemplateById('tor-custom-web-microservices')!;
    const existing = [
      {
        id: 'old-1',
        code: 'ТР-ФУН-01',
        category: 'functional' as const,
        title: 'Существующее требование',
        description: 'Существующее описание.',
      },
    ];

    const result = applyTorTemplate({
      template,
      currentRequirements: existing,
      mode: 'append',
    });

    expect(result).toHaveLength(existing.length + template.requirements.length);
    // Первый элемент - существующий
    expect(result[0].title).toBe('Существующее требование');
    // Коллизия ТР-ФУН-01 разрешена добавлением суффикса
    const duplicates = result.filter((r) => r.code === 'ТР-ФУН-01');
    expect(duplicates).toHaveLength(1);
    expect(result.some((r) => r.code === 'ТР-ФУН-01-2')).toBe(true);
  });
});
