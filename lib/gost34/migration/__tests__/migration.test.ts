import { describe, it, expect } from 'vitest';
import {
  GOST34_GENERATOR_VERSION,
  MIGRATION_TARGET_PROFILE_ID,
  buildBindingUpdate,
  isMigrated,
  resolveProjectBinding,
} from '../binding';
import { buildMigrationDiff } from '../diff';
import { CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID } from '../../standards';

const legacyProject = {
  id: 'calc-legacy-1',
  name: 'Автоматизированная система учёта заявок',
  customer: 'ПАО «ТехноСервис»',
  pmHours: 24,
  stages: [
    {
      id: 's1',
      order: 1,
      name: 'Обследование',
      role: 'аналитик',
      hours: 40,
      requirements: 'Система должна вести реестр заявок с историей изменений.',
    },
    {
      id: 's2',
      order: 2,
      name: 'Разработка',
      role: 'разработчик',
      hours: 120,
      requirements: 'Система должна предоставлять веб-интерфейс оператора.',
    },
  ],
  risks: [{ id: 'r1', description: 'Задержка согласования', hours: 8 }],
};

describe('Нормативная привязка проекта', () => {
  it('читает проект без сохранённого профиля как legacy и помечает привязку выведенной', () => {
    const binding = resolveProjectBinding(null);

    expect(binding.standardProfileId).toBe(LEGACY_GOST34_PROFILE_ID);
    expect(binding.standardProfileVersion).toBe('1989');
    expect(binding.generatorVersion).toBe('legacy');
    expect(binding.generatedAt).toBeNull();
    expect(binding.inferred).toBe(true);
    expect(isMigrated(binding)).toBe(false);
  });

  it('сохраняет прочитанные из проекта значения и не выдаёт их за умолчание', () => {
    const generatedAt = new Date('2026-03-01T10:00:00.000Z');
    const binding = resolveProjectBinding({
      standardProfileId: CURRENT_GOST34_PROFILE_ID,
      standardProfileVersion: '2020',
      generatorVersion: '1.9.0',
      generatedAt,
    });

    expect(binding.inferred).toBe(false);
    expect(binding.generatorVersion).toBe('1.9.0');
    expect(binding.generatedAt).toBe(generatedAt.toISOString());
    expect(isMigrated(binding)).toBe(true);
  });

  it('игнорирует неизвестный профиль, а не подставляет его как сохранённый', () => {
    const binding = resolveProjectBinding({ standardProfileId: 'ru-gost34-2035' });

    expect(binding.standardProfileId).toBe(LEGACY_GOST34_PROFILE_ID);
    expect(binding.inferred).toBe(true);
  });

  it('готовит запись привязки с версией генератора и временем выпуска', () => {
    const generatedAt = new Date('2026-08-12T09:30:00.000Z');
    const update = buildBindingUpdate(CURRENT_GOST34_PROFILE_ID, generatedAt);

    expect(update).toEqual({
      standardProfileId: CURRENT_GOST34_PROFILE_ID,
      standardProfileVersion: '2020',
      generatorVersion: GOST34_GENERATOR_VERSION,
      generatedAt,
    });
  });

  it('по умолчанию привязывает выпуск к действующему профилю', () => {
    expect(buildBindingUpdate().standardProfileId).toBe(MIGRATION_TARGET_PROFILE_ID);
  });
});

describe('Предпросмотр миграции на ГОСТ 34.602-2020', () => {
  const diff = buildMigrationDiff({
    calculation: legacyProject,
    fromProfileId: LEGACY_GOST34_PROFILE_ID,
    toProfileId: CURRENT_GOST34_PROFILE_ID,
  });

  it('показывает переход между профилями', () => {
    expect(diff.alreadyMigrated).toBe(false);
    expect(diff.from.primaryStandard).toBe('ГОСТ 34.602-89');
    expect(diff.to.primaryStandard).toBe('ГОСТ 34.602-2020');
  });

  it('перечисляет новые разделы структуры ТЗ 2020 года', () => {
    expect(diff.structure.added.length).toBeGreaterThan(0);
    const titles = diff.structure.added.map((s) => s.title.toLowerCase());
    expect(titles.some((t) => t.includes('требовани'))).toBe(true);
  });

  it('сообщает, какие legacy-ссылки уходят из документа и чем заменяются', () => {
    const citations = diff.removedLegacyReferences.map((ref) => ref.citation);
    expect(citations).toContain('ГОСТ 34.602-89');

    const primary = diff.removedLegacyReferences.find((ref) => ref.citation === 'ГОСТ 34.602-89');
    expect(primary?.replacedBy).toBe('ГОСТ 34.602-2020');
  });

  it('не оставляет в новом документе ссылок, объявленных снятыми', () => {
    for (const ref of diff.removedLegacyReferences) {
      expect(ref.citation).not.toBe('');
      expect(ref.citation).not.toContain('34.602-2020');
    }
  });

  it('показывает нормативы, применимость которых не подтверждена', () => {
    expect(diff.inapplicableRegulations.length).toBeGreaterThan(0);
    for (const item of diff.inapplicableRegulations) {
      expect(['UNKNOWN', 'NOT_APPLICABLE']).toContain(item.status);
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });

  it('не мигрирует проект, уже выпускаемый по действующему профилю', () => {
    const sameProfile = buildMigrationDiff({
      calculation: legacyProject,
      fromProfileId: CURRENT_GOST34_PROFILE_ID,
      toProfileId: CURRENT_GOST34_PROFILE_ID,
    });

    expect(sameProfile.alreadyMigrated).toBe(true);
    expect(sameProfile.structure.added).toHaveLength(0);
    expect(sameProfile.structure.removed).toHaveLength(0);
    expect(sameProfile.removedLegacyReferences).toHaveLength(0);
  });
});
