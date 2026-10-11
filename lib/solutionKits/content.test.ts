/**
 * Схема содержимого набора решений (#103 WP-7a): форма, уникальность
 * elementId, разрешение ссылок, встроенные наборы, дифф версий и правила
 * переходов статусов.
 */
import { describe, expect, it } from 'vitest';
import {
  checkKitContent,
  emptyKitContent,
  KIT_KEY_PATTERN,
  parseKitContent,
  parseKitScope,
  validateKitContent,
  type SolutionKitContent,
} from './content';
import { builtinKits, presetKit, torTemplateKit } from './builtin';
import { diffKitVersions } from './diff';
import {
  canEditKitDrafts,
  canGovernKit,
  canTransitionVersion,
  isVersionEditable,
  nextKitStatusOnRestore,
} from './rules';
import { INDUSTRY_PRESETS } from '@/lib/presets/industryPresets';
import { GOST34_TOR_TEMPLATES } from '@/lib/gost34/torTemplates';

function sample(): SolutionKitContent {
  return {
    schemaVersion: 1,
    fields: [
      {
        elementId: 'field-sites',
        key: 'sites',
        label: 'Площадки',
        type: 'number',
        options: [],
        required: true,
      },
    ],
    requirements: [
      {
        elementId: 'req-1',
        code: 'ТР-1',
        category: 'functional',
        title: 'Сбор журналов',
        description: 'Система должна собирать журналы.',
        criterion: 'Журналы поступают',
      },
    ],
    stages: [
      {
        elementId: 'stage-01',
        name: 'Монтаж',
        role: 'engineer',
        baseHours: 8,
        hoursPerUnit: 4,
        driver: 'field-sites',
        notes: null,
        requirementIds: ['req-1'],
      },
    ],
    risks: [
      {
        elementId: 'risk-01',
        description: 'Задержка доступа',
        hours: 8,
        stageIds: ['stage-01'],
        requirementIds: [],
      },
    ],
    checks: [
      {
        elementId: 'chk-1',
        requirementIds: ['req-1'],
        criteria: 'Журналы видны в консоли',
        method: 'DEMONSTRATION',
      },
    ],
    fragments: [
      {
        elementId: 'frag-1',
        sectionKey: 'scope',
        title: 'Область',
        text: 'Текст',
        requirementIds: ['req-1'],
      },
    ],
  };
}

describe('parseKitContent — форма', () => {
  it('принимает корректное содержимое и отбрасывает лишние ключи', () => {
    const raw = { ...sample(), extra: 1 } as unknown as Record<string, unknown>;
    (raw.requirements as Record<string, unknown>[])[0].junk = 'x';
    const { content, issues } = parseKitContent(raw);
    expect(issues).toEqual([]);
    expect(content).toEqual(sample());
    expect(validateKitContent(content!)).toEqual([]);
  });

  it('заполняет умолчания для пустых разделов и необязательных полей', () => {
    const { content } = parseKitContent({
      stages: [{ elementId: 's', name: 'Этап', role: 'pm', baseHours: 1 }],
    });
    expect(content).toEqual({
      ...emptyKitContent(),
      stages: [
        {
          elementId: 's',
          name: 'Этап',
          role: 'pm',
          baseHours: 1,
          hoursPerUnit: 0,
          driver: null,
          notes: null,
          requirementIds: [],
        },
      ],
    });
  });

  it('отклоняет неверную форму с путями ошибок', () => {
    const { content, issues } = parseKitContent({
      schemaVersion: 2,
      stages: [{ elementId: '', name: '', role: 'boss', baseHours: -1 }],
      checks: [{ elementId: 'c', criteria: 'x', method: 'GUESS', requirementIds: 'req' }],
      fields: [{ elementId: 'f', key: '1bad', label: 'L', type: 'date' }],
    });
    expect(content).toBeNull();
    const paths = issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'stages[0].elementId',
        'stages[0].name',
        'stages[0].role',
        'stages[0].baseHours',
        'checks[0].method',
        'checks[0].requirementIds',
        'fields[0].type',
        'fields[0].key',
      ]),
    );
    expect(issues.every((i) => i.code === 'shape')).toBe(true);
  });

  it('не принимает не-объект', () => {
    expect(parseKitContent([]).content).toBeNull();
    expect(parseKitContent(null).content).toBeNull();
  });
});

describe('validateKitContent — целостность', () => {
  it('находит дубликаты elementId между разделами', () => {
    const c = sample();
    c.risks[0].elementId = 'req-1';
    const issues = validateKitContent(c);
    expect(issues.map((i) => i.code)).toContain('duplicate-element-id');
  });

  it('находит висячие ссылки и ссылки не в тот раздел', () => {
    const c = sample();
    c.checks[0].requirementIds = ['req-404', 'stage-01'];
    c.risks[0].stageIds = ['req-1'];
    c.stages[0].driver = 'field-404';
    const issues = validateKitContent(c);
    const byPath = Object.fromEntries(issues.map((i) => [i.path, i.code]));
    expect(byPath['checks[0].requirementIds[0]']).toBe('dangling-ref');
    expect(byPath['checks[0].requirementIds[1]']).toBe('wrong-ref-section');
    expect(byPath['risks[0].stageIds[0]']).toBe('wrong-ref-section');
    expect(byPath['stages[0].driver[0]']).toBe('dangling-ref');
  });

  it('удаление требования оставляет висячие ссылки — версия не утверждается', () => {
    const c = sample();
    c.requirements = [];
    const codes = validateKitContent(c).map((i) => `${i.path}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'stages[0].requirementIds[0]:dangling-ref',
        'checks[0].requirementIds[0]:dangling-ref',
        'fragments[0].requirementIds[0]:dangling-ref',
      ]),
    );
  });

  it('проверка без требований, повтор ссылки, нечисловой драйвер, ключ поля, формат id', () => {
    const c = sample();
    c.checks.push({ elementId: 'chk-2', requirementIds: [], criteria: 'x', method: null });
    c.fragments[0].requirementIds = ['req-1', 'req-1'];
    c.fields[0].type = 'text';
    c.fields.push({ ...c.fields[0], elementId: 'field-dup' });
    c.requirements[0].elementId = 'плохой id';
    c.stages[0].requirementIds = ['плохой id'];
    c.checks[0].requirementIds = ['плохой id'];
    c.fragments[0].requirementIds = ['плохой id', 'плохой id'];
    const codes = validateKitContent(c).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'check-without-requirement',
        'duplicate-ref',
        'driver-not-number',
        'duplicate-field-key',
        'invalid-element-id',
      ]),
    );
  });

  it('checkKitContent разделяет форму и целостность', () => {
    expect(checkKitContent({ stages: 'x' }).shapeIssues).toHaveLength(1);
    const c = sample();
    c.checks[0].requirementIds = ['nope'];
    const r = checkKitContent(c);
    expect(r.shapeIssues).toEqual([]);
    expect(r.issues).toHaveLength(1);
  });
});

describe('parseKitScope', () => {
  it('нормализует списки и отклоняет неверную форму', () => {
    expect(parseKitScope({ industries: [' ИБ ', 'ИБ', ''], notes: ' x ' })).toEqual({
      industries: ['ИБ'],
      productTypes: [],
      notes: 'x',
    });
    expect(parseKitScope(undefined)).toEqual({ industries: [], productTypes: [], notes: '' });
    expect(parseKitScope({ industries: 'ИБ' })).toBeNull();
    expect(parseKitScope([])).toBeNull();
  });
});

describe('встроенные наборы', () => {
  const kits = builtinKits();

  it('по набору на каждый пресет и шаблон ТЗ, ключи уникальны и валидны', () => {
    expect(kits).toHaveLength(INDUSTRY_PRESETS.length + GOST34_TOR_TEMPLATES.length);
    const keys = kits.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(KIT_KEY_PATTERN);
  });

  it('каждый встроенный набор проходит форму и целостность', () => {
    for (const kit of kits) {
      const r = checkKitContent(kit.content);
      expect({ key: kit.key, shape: r.shapeIssues, issues: r.issues }).toEqual({
        key: kit.key,
        shape: [],
        issues: [],
      });
      // Каноническая форма: разбор не меняет содержимое (сид пишет то же, что проверено).
      expect(r.content).toEqual(kit.content);
    }
  });

  it('пресет: поля, этапы с драйверами по elementId, риски', () => {
    const preset = INDUSTRY_PRESETS[0];
    const kit = presetKit(preset);
    expect(kit.source).toBe(`preset:${preset.id}`);
    expect(kit.content.stages).toHaveLength(preset.stageTemplates.length);
    expect(kit.content.risks).toHaveLength(preset.riskTemplates.length);
    const withDriver = preset.stageTemplates.find((s) => s.driverFieldKey);
    if (withDriver) {
      const stage = kit.content.stages.find((s) => s.name === withDriver.name)!;
      expect(stage.driver).toBe(`field-${withDriver.driverFieldKey}`);
    }
  });

  it('шаблон ТЗ: требования с исходными id и проверки по критериям', () => {
    const tpl = GOST34_TOR_TEMPLATES[0];
    const kit = torTemplateKit(tpl);
    expect(kit.content.requirements.map((r) => r.elementId)).toEqual(
      tpl.requirements.map((r) => r.id),
    );
    for (const chk of kit.content.checks) {
      expect(chk.requirementIds).toHaveLength(1);
      expect(chk.elementId).toBe(`chk-${chk.requirementIds[0]}`);
      expect(chk.method).toBeNull();
    }
  });

  it('сборка детерминирована', () => {
    expect(builtinKits()).toEqual(kits);
  });
});

describe('diffKitVersions', () => {
  it('первая версия — всё добавлено', () => {
    const d = diffKitVersions(null, { version: 1, content: sample() });
    expect(d.summary).toEqual({ added: 6, removed: 0, changed: 0, unchanged: 0 });
    expect(d.from).toBeNull();
  });

  it('добавленные, удалённые, изменённые по elementId и перестановка', () => {
    const before = sample();
    const after = sample();
    after.stages[0].baseHours = 16;
    after.stages[0].notes = 'Новое';
    after.risks = [];
    after.requirements.push({
      elementId: 'req-2',
      code: null,
      category: 'security',
      title: 'Шифрование',
      description: 'Система должна шифровать.',
      criterion: null,
    });
    after.requirements.reverse();
    const d = diffKitVersions({ version: 1, content: before }, { version: 2, content: after });
    expect(d.sections.stages.changed).toEqual([
      expect.objectContaining({ elementId: 'stage-01', fields: ['baseHours', 'notes'] }),
    ]);
    expect(d.sections.risks.removed.map((e) => e.elementId)).toEqual(['risk-01']);
    expect(d.sections.requirements.added.map((e) => e.elementId)).toEqual(['req-2']);
    expect(d.sections.requirements.reordered).toBe(false); // общий элемент один
    expect(d.summary).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 4 });
    expect(d.identical).toBe(false);
  });

  it('одинаковые версии и перестановка без правок', () => {
    const a = sample();
    a.requirements.push({ ...a.requirements[0], elementId: 'req-2' });
    const b = structuredClone(a);
    expect(diffKitVersions({ version: 1, content: a }, { version: 2, content: b }).identical).toBe(
      true,
    );
    b.requirements.reverse();
    const d = diffKitVersions({ version: 1, content: a }, { version: 2, content: b });
    expect(d.sections.requirements.reordered).toBe(true);
    expect(d.summary.changed).toBe(0);
    expect(d.identical).toBe(false);
  });

  it('элемент, сменивший раздел, — удалён из одного и добавлен в другой', () => {
    const a = sample();
    const b = sample();
    b.risks = [];
    b.fragments.push({
      elementId: 'risk-01',
      sectionKey: 'risks',
      title: null,
      text: 'Риск как текст',
      requirementIds: [],
    });
    const d = diffKitVersions({ version: 1, content: a }, { version: 2, content: b });
    expect(d.sections.risks.removed).toHaveLength(1);
    expect(d.sections.fragments.added).toHaveLength(1);
  });
});

describe('правила библиотеки', () => {
  const admin = { userId: 'a', role: 'admin' };
  const owner = { userId: 'o', role: 'architect' };
  const other = { userId: 'x', role: 'architect' };
  const presale = { userId: 'p', role: 'presale' };

  it('черновики правят архитектор и администратор', () => {
    expect(canEditKitDrafts(admin)).toBe(true);
    expect(canEditKitDrafts(other)).toBe(true);
    expect(canEditKitDrafts(presale)).toBe(false);
  });

  it('утверждает администратор или владелец-архитектор; системный набор — только админ', () => {
    expect(canGovernKit(admin, { ownerId: 'o' })).toBe(true);
    expect(canGovernKit(owner, { ownerId: 'o' })).toBe(true);
    expect(canGovernKit(other, { ownerId: 'o' })).toBe(false);
    expect(canGovernKit({ userId: 'o', role: 'presale' }, { ownerId: 'o' })).toBe(false);
    expect(canGovernKit(admin, { ownerId: null })).toBe(true);
    expect(canGovernKit(owner, { ownerId: null })).toBe(false);
  });

  it('переходы версий: draft → approved → archived, назад нельзя', () => {
    expect(canTransitionVersion('draft', 'approved')).toBe(true);
    expect(canTransitionVersion('approved', 'archived')).toBe(true);
    expect(canTransitionVersion('approved', 'draft')).toBe(false);
    expect(canTransitionVersion('archived', 'approved')).toBe(false);
    expect(canTransitionVersion('draft', 'archived')).toBe(false);
    expect(isVersionEditable('draft')).toBe(true);
    expect(isVersionEditable('approved')).toBe(false);
    expect(isVersionEditable('archived')).toBe(false);
  });

  it('возврат набора из архива учитывает утверждённые версии', () => {
    expect(nextKitStatusOnRestore(true)).toBe('approved');
    expect(nextKitStatusOnRestore(false)).toBe('draft');
  });
});
