import { describe, expect, it } from 'vitest';
import { RequirementsRepository } from '../repository';

describe('RequirementsRepository v2', () => {
  it('adds, updates, approves and filters requirements', () => {
    const repo = new RequirementsRepository();

    const req1 = repo.add({
      code: 'REQ-01',
      title: 'Аутентификация по ГОСТ',
      originalText: 'Пользователи должны входить по сертификатам ГОСТ.',
      category: 'security',
    });

    expect(req1.id).toBeDefined();
    expect(req1.approval.status).toBe('DRAFT');
    expect(repo.getAll()).toHaveLength(1);
    expect(repo.getApproved()).toHaveLength(0);

    // Approve
    repo.approve(req1.id, 'lead_architect');
    expect(repo.get(req1.id)?.approval.status).toBe('APPROVED');
    expect(repo.get(req1.id)?.approval.approvedBy).toBe('lead_architect');
    expect(repo.getApproved()).toHaveLength(1);

    // Add another requirement
    const req2 = repo.add({
      code: 'REQ-02',
      title: 'Экспорт в Excel',
      originalText: 'Выгрузка отчетов в формате XLSX.',
      category: 'functional',
    });

    expect(repo.getByCategory('security')).toHaveLength(1);
    expect(repo.getByCategory('functional')).toHaveLength(1);
    expect(repo.getByStatus('DRAFT')).toHaveLength(1);

    // Update
    repo.update(req2.id, { normalizedText: 'Выгрузка сводных таблиц в XLSX по ГОСТ.' });
    expect(repo.get(req2.id)?.normalizedText).toContain('Выгрузка сводных таблиц');
  });

  it('detects duplicate requirements using text similarity', () => {
    const repo = new RequirementsRepository();

    repo.add({
      code: 'REQ-A',
      title: 'Защита персональных данных 152-ФЗ',
      originalText: 'Система должна соответствовать требованиям 152-ФЗ и защищать ПДн.',
      category: 'security',
    });

    repo.add({
      code: 'REQ-B',
      title: 'Защита персональных данных 152-ФЗ',
      originalText: 'Система должна соответствовать требованиям 152-ФЗ и защищать персональные данные.',
      category: 'security',
    });

    repo.add({
      code: 'REQ-C',
      title: 'Генерация PDF отчетов',
      originalText: 'Система генерирует PDF отчеты с печатью.',
      category: 'functional',
    });

    const duplicates = repo.findDuplicates(0.65);
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0].item1.code).toBe('REQ-A');
    expect(duplicates[0].item2.code).toBe('REQ-B');
    expect(duplicates[0].similarity).toBeGreaterThan(0.7);
  });

  it('validates requirement relations and missing references', () => {
    const repo = new RequirementsRepository();

    const req1 = repo.add({
      code: 'REQ-1',
      title: 'База данных',
      originalText: 'СУБД PostgreSQL.',
    });

    repo.add({
      code: 'REQ-2',
      title: 'Кластеризация БД',
      originalText: 'Отказоустойчивый кластер.',
      relations: [
        { targetRequirementId: req1.id, type: 'DEPENDS_ON' },
        { targetRequirementId: 'non-existent-id', type: 'REFINES' },
      ],
    });

    const errors = repo.validateRelations();
    expect(errors).toHaveLength(1);
    expect(errors[0].missingTargetId).toBe('non-existent-id');
    expect(errors[0].relationType).toBe('REFINES');
  });

  it('generates clean document projection sections without template fluff', () => {
    const repo = new RequirementsRepository();

    const r1 = repo.add({
      code: 'REQ-SEC-01',
      title: 'Шифрование каналов',
      originalText: 'Шифрование трафика по протоколу TLS 1.3.',
      category: 'security',
    });
    repo.approve(r1.id, 'security_officer');

    const r2 = repo.add({
      code: 'REQ-INT-01',
      title: 'REST API 1С',
      originalText: 'Интеграция с учетной системой через REST API.',
      category: 'technical',
    });
    repo.approve(r2.id, 'tech_lead');

    const sections = repo.toProjectionSections({ onlyApproved: true });
    expect(sections.length).toBeGreaterThan(0);

    const secSection = sections.find((s) => s.numStr === '4.1.2');
    expect(secSection).toBeDefined();
    expect(secSection?.paragraphs[0]).toContain('REQ-SEC-01');
    expect(secSection?.paragraphs[0]).toContain('Шифрование каналов');
  });

  it('serializes and deserializes from JSON losslessly', () => {
    const repo = new RequirementsRepository();
    repo.add({
      code: 'REQ-01',
      title: 'Тест',
      originalText: 'Исходный текст.',
      normalizedText: 'Нормализованный текст.',
    });

    const json = repo.toJSON();
    const restored = RequirementsRepository.fromJSON(json);

    expect(restored.getAll()).toHaveLength(1);
    expect(restored.getAll()[0].code).toBe('REQ-01');
    expect(restored.getAll()[0].normalizedText).toBe('Нормализованный текст.');
  });
});
