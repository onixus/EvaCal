/**
 * Применение наборов решений и предложения обновлений (#103 WP-7b), чистая
 * логика: воспроизводимость плана, провенанс, ссылки без висячих концов,
 * запись в снимок комплекта, дифф проекта с новой версией, перенос выбранных
 * изменений, сохранение originRef в плане этапов и в адаптерах требований.
 */
import { describe, expect, it } from 'vitest';
import type { SolutionKitContent } from '@/lib/solutionKits/content';
import { extractCheckSeeds } from '@/lib/acceptance/rules';
import {
  fromGost34RequirementItem,
  toGost34RequirementItem,
} from '@/lib/gost34/requirements/adapters';
import { expandWithApprovals, primaryInputsFromStageRows } from '@/lib/scheduling';
import { formatOriginRef, parseOriginRef, readOrigin } from './origin';
import {
  buildApplicationPlan,
  isEmptyPlan,
  parseDriverValues,
  parseSelection,
  type KitSelection,
} from './plan';
import { applyPlanToSnapshot, recomputeKitCriteria } from './snapshot';
import { applySectionOverrides } from '@/lib/gost34/generation/overrides';
import {
  applyKitAppendices,
  editableParagraphs,
  kitAppendicesFromFragments,
} from '@/lib/gost34/generation/kitAppendices';
import { normalizeRequirementsWithLlm } from '@/lib/gost34/parser/llmNormalizer';
import { resolveTzSectionId } from './sections';
import { overlaysForDocument } from '@/lib/gost34/llm/tzAuthor/project';
import type { Gost34RequirementItem, Gost34Section } from '@/lib/gost34/types';
import {
  applySnapshotUpdate,
  buildUpdateProposal,
  collectProjectKitUsage,
  existingStateFor,
  planCalculationUpdate,
  type ProjectRiskRow,
  type ProjectStageRow,
} from './update';

const kit = { id: 'kit1', key: 'siem.basic' };

function content(): SolutionKitContent {
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
        title: 'Сбор',
        description: 'Система должна собирать журналы.',
        criterion: 'Журналы поступают',
      },
      {
        elementId: 'req-2',
        code: null,
        category: 'unknown-cat',
        title: 'Шифрование',
        description: 'Система должна шифровать.',
        criterion: null,
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
        notes: 'Примечание',
        requirementIds: ['req-1'],
      },
      {
        elementId: 'stage-02',
        name: 'Обучение',
        role: 'consultant',
        baseHours: 6,
        hoursPerUnit: 0,
        driver: null,
        notes: null,
        requirementIds: ['req-2'],
      },
    ],
    risks: [
      {
        elementId: 'risk-01',
        description: 'Задержка',
        hours: 8,
        stageIds: ['stage-01'],
        requirementIds: [],
      },
    ],
    checks: [
      { elementId: 'chk-1', requirementIds: ['req-1'], criteria: 'В консоли', method: 'TEST' },
      { elementId: 'chk-2', requirementIds: ['req-2'], criteria: 'TLS', method: null },
    ],
    fragments: [
      {
        elementId: 'frag-1',
        sectionKey: 'scope',
        title: 'Область',
        text: 'А\nБ',
        requirementIds: [],
      },
    ],
  };
}

const both: KitSelection = {
  targets: { calculation: true, package: true },
  excluded: [],
  overrides: {},
  driverValues: {},
};

describe('originRef', () => {
  it('формат и разбор', () => {
    const ref = formatOriginRef({ kitId: 'k', kitVersion: 3, elementId: 'a:b.c' });
    expect(ref).toBe('kit:k@3#a:b.c');
    expect(parseOriginRef(ref)).toEqual({ kitId: 'k', kitVersion: 3, elementId: 'a:b.c' });
    expect(parseOriginRef('manual')).toBeNull();
    expect(parseOriginRef(null)).toBeNull();
    expect(readOrigin({ kitId: 'k', kitKey: 'x', kitVersion: 1.5, elementId: 'e' })).toBeNull();
  });
});

describe('parseSelection', () => {
  it('нормализует и проверяет', () => {
    expect(parseSelection({ targets: {} })).toMatch(/цель/);
    expect(parseSelection({ targets: { package: true }, excluded: [1] })).toMatch(/excluded/);
    expect(parseSelection({ targets: { package: true }, overrides: { a: { hours: -1 } } })).toMatch(
      /hours/,
    );
    expect(parseSelection({ targets: { package: true }, overrides: { a: { code: 'x' } } })).toMatch(
      /не правится/,
    );
    expect(
      parseSelection({
        targets: { calculation: true },
        excluded: ['b', 'a', 'b'],
        overrides: { a: { name: ' Имя ' } },
        driverValues: { sites: 2 },
      }),
    ).toEqual({
      targets: { calculation: true, package: false },
      excluded: ['a', 'b'],
      overrides: { a: { name: 'Имя' } },
      driverValues: { sites: 2 },
    });
  });
});

describe('buildApplicationPlan', () => {
  const answers = { sites: 3 };

  it('провенанс, часы по драйверу, адаптация, детерминированные id', () => {
    const plan = buildApplicationPlan({
      kit,
      version: { version: 2, content: content() },
      selection: {
        ...both,
        excluded: ['stage-02'],
        overrides: { 'risk-01': { hours: 5 }, 'stage-01': { name: 'Монтаж ПАК' } },
      },
      answers,
    });
    expect(plan.stages).toEqual([
      {
        elementId: 'stage-01',
        originRef: 'kit:kit1@2#stage-01',
        name: 'Монтаж ПАК',
        role: 'engineer',
        hours: 20,
        requirements: 'Примечание',
      },
    ]);
    expect(plan.risks[0]).toMatchObject({ hours: 5, originRef: 'kit:kit1@2#risk-01' });
    expect(plan.requirements.map((r) => r.id)).toEqual([
      'kit.siem.basic.req-1',
      'kit.siem.basic.req-2',
    ]);
    expect(plan.requirements[1]).toMatchObject({ code: 'req-2', category: 'functional' });
    expect(plan.requirements[0].origin).toEqual({
      kitId: 'kit1',
      kitKey: 'siem.basic',
      kitVersion: 2,
      elementId: 'req-1',
    });
    // req-2 → stage-02 не связывается: этап исключён.
    expect(plan.links).toEqual([{ requirementElementId: 'req-1', stageElementId: 'stage-01' }]);
    expect(plan.skipped).toEqual([{ elementId: 'stage-02', reason: 'excluded' }]);
  });

  it('воспроизводим: та же версия и адаптация — тот же план', () => {
    const args = {
      kit,
      version: { version: 1, content: content() },
      selection: { ...both, driverValues: { sites: 7 } },
      answers,
    };
    expect(buildApplicationPlan(args)).toEqual(buildApplicationPlan(structuredClone(args)));
    expect(buildApplicationPlan(args).stages[0].hours).toBe(8 + 4 * 7);
  });

  it('проверка без выбранных требований не применяется; цели ограничивают разделы', () => {
    const plan = buildApplicationPlan({
      kit,
      version: { version: 1, content: content() },
      selection: { ...both, excluded: ['req-2'] },
      answers,
    });
    expect(plan.checks.map((c) => c.origin.elementId)).toEqual(['chk-1']);
    expect(plan.skipped).toContainEqual({ elementId: 'chk-2', reason: 'requirement-not-selected' });

    const calcOnly = buildApplicationPlan({
      kit,
      version: { version: 1, content: content() },
      selection: { ...both, targets: { calculation: true, package: false } },
      answers,
    });
    expect(calcOnly.requirements).toEqual([]);
    expect(calcOnly.links).toEqual([]);
    expect(calcOnly.skipped).toContainEqual({ elementId: 'req-1', reason: 'no-target' });
  });

  it('уже применённые элементы пропускаются, связи к ним строятся', () => {
    const plan = buildApplicationPlan({
      kit,
      version: { version: 1, content: content() },
      selection: both,
      answers,
      existing: {
        presentElementIds: new Set(['stage-01']),
        stageIdByElement: new Map([['stage-01', 'S1']]),
        requirementIdByElement: new Map(),
        snapshotRequirementIds: new Set(),
      },
    });
    expect(plan.stages.map((s) => s.elementId)).toEqual(['stage-02']);
    expect(plan.links).toContainEqual({
      requirementElementId: 'req-1',
      stageElementId: 'stage-01',
    });
  });
});

describe('applyPlanToSnapshot', () => {
  it('требования с origin, критерии проверок, связи, фрагменты; засев проверок', () => {
    const plan = buildApplicationPlan({
      kit,
      version: { version: 1, content: content() },
      selection: both,
      answers: { sites: 1 },
    });
    const base = {
      requirements: [{ id: 'manual-1', title: 'Ручное' }],
      sectionOverrides: { scope: { title: 'Своя', paragraphs: ['Свой абзац'] } },
    };
    const { snapshot, links } = applyPlanToSnapshot(
      base,
      plan,
      new Map([
        ['stage-01', 'S1'],
        ['stage-02', 'S2'],
      ]),
      new Map(),
    );
    expect(base.requirements).toHaveLength(1); // исходный снимок не мутирует
    const req1 = (snapshot.requirements as Record<string, unknown>[])[1];
    expect(req1).toMatchObject({
      id: 'kit.siem.basic.req-1',
      acceptanceCriteria: ['Журналы поступают', 'В консоли'],
      criterion: 'Журналы поступают; В консоли',
      verificationMethod: 'TEST',
    });
    expect(links).toEqual([
      { requirementId: 'kit.siem.basic.req-1', stageId: 'S1' },
      { requirementId: 'kit.siem.basic.req-2', stageId: 'S2' },
    ]);
    expect(snapshot.manualLinks).toContainEqual({
      sourceId: 'kit.siem.basic.req-1',
      targetId: 'S1',
      method: 'MANUAL',
      approved: true,
    });
    // Ручные правки разделов не трогаются; фрагмент — в реестре с id раздела
    // схемы (прежний ключ `scope` приведён к «Назначению АС»).
    expect(snapshot.sectionOverrides).toEqual(base.sectionOverrides);
    expect(snapshot.kitFragments).toEqual([
      expect.objectContaining({ sectionKey: 'tz2020-goals-purpose', text: 'А\nБ' }),
    ]);
    const seeds = extractCheckSeeds(snapshot);
    expect(seeds.map((s) => [s.requirementId, s.method, s.criteria])).toEqual([
      ['kit.siem.basic.req-1', 'TEST', ['Журналы поступают', 'В консоли']],
      ['kit.siem.basic.req-2', null, ['TLS']],
    ]);
  });
});

describe('провенанс переживает план этапов и адаптеры требований', () => {
  it('originRef проходит через primaryInputsFromStageRows и expandWithApprovals', () => {
    const primary = primaryInputsFromStageRows([
      {
        id: 's1',
        name: 'Монтаж',
        role: 'engineer',
        hours: 4,
        isApprovalTask: false,
        originRef: 'kit:k@1#stage-01',
      },
      { id: 'a1', name: 'Согл', role: 'customer', hours: 0, isApprovalTask: true },
    ]);
    expect(primary[0].originRef).toBe('kit:k@1#stage-01');
    const items = expandWithApprovals(primary);
    expect(items[0].originRef).toBe('kit:k@1#stage-01');
    expect(items[1].originRef).toBeUndefined(); // согласование своего origin не несёт
    // Редактор этапов originRef не присылает — значение строки не трогается.
    expect(expandWithApprovals([{ name: 'x', role: 'pm', hours: 1 }])[0]).not.toHaveProperty(
      'originRef',
    );
  });

  it('origin требования сохраняется в v2 source.origin и обратно', () => {
    const origin = { kitId: 'k', kitKey: 'kk', kitVersion: 2, elementId: 'req-1' };
    const v2 = fromGost34RequirementItem({
      id: 'r',
      code: 'C',
      category: 'functional',
      title: 'T',
      description: 'D',
      origin,
    });
    expect(v2.source?.origin).toEqual(origin);
    expect(toGost34RequirementItem(v2).origin).toEqual(origin);
  });
});

// ── Обновления ───────────────────────────────────────────────────────────

function appliedProject() {
  const v1 = content();
  const plan = buildApplicationPlan({
    kit,
    version: { version: 1, content: v1 },
    selection: { ...both, excluded: ['stage-02'], overrides: { 'stage-01': { name: 'Монтаж!' } } },
    answers: { sites: 1 },
  });
  const stages: ProjectStageRow[] = [
    {
      id: 'M',
      name: 'Ручной',
      role: 'pm',
      hours: 2,
      requirements: null,
      isApprovalTask: false,
      originRef: null,
    },
    ...plan.stages.map((s, i) => ({
      id: `S${i + 1}`,
      name: s.name,
      role: s.role,
      hours: s.hours,
      requirements: s.requirements,
      isApprovalTask: false,
      originRef: s.originRef,
    })),
  ];
  const risks: ProjectRiskRow[] = plan.risks.map((r, i) => ({
    id: `R${i + 1}`,
    description: r.description,
    hours: r.hours,
    order: i,
    originRef: r.originRef,
  }));
  const { snapshot } = applyPlanToSnapshot({}, plan, new Map([['stage-01', 'S1']]), new Map());
  return { v1, stages, risks, snapshot };
}

function v2(): SolutionKitContent {
  const c = content();
  c.stages[0].baseHours = 10;
  c.requirements[0].title = 'Сбор и хранение';
  c.risks = [];
  c.stages.push({
    elementId: 'stage-03',
    name: 'Шифрование каналов',
    role: 'engineer',
    baseHours: 4,
    hoursPerUnit: 0,
    driver: null,
    notes: null,
    requirementIds: ['req-2'],
  });
  c.fragments[0].text = 'А\nВ';
  return c;
}

describe('buildUpdateProposal', () => {
  it('дифф проекта с новой версией по elementId', () => {
    const { v1, stages, risks, snapshot } = appliedProject();
    const usage = collectProjectKitUsage(stages, risks, snapshot).get('kit1')!;
    expect(usage.versions).toEqual([1]);
    const p = buildUpdateProposal({
      kit,
      to: { version: 2, content: v2() },
      versions: new Map([[1, v1]]),
      usage,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    const byId = Object.fromEntries(p.changes.map((c) => [c.elementId, c]));
    expect(byId['stage-01']).toMatchObject({
      kind: 'changed',
      fields: ['hours', 'name'],
      kitChanged: true,
    });
    expect(byId['req-1']).toMatchObject({ kind: 'changed', fields: ['title'] });
    expect(byId['risk-01']).toMatchObject({ kind: 'removed' });
    expect(byId['stage-03']).toMatchObject({ kind: 'added' });
    expect(byId['frag-1']).toMatchObject({ kind: 'changed', fields: ['text'] });
    expect(byId['stage-02']).toBeUndefined(); // исключён при применении
    expect(p.unchanged).toEqual(['chk-1', 'chk-2', 'req-2']);
  });

  it('правка проекта при неизменном наборе — kitChanged = false', () => {
    const { v1, stages, risks, snapshot } = appliedProject();
    const usage = collectProjectKitUsage(stages, risks, snapshot).get('kit1')!;
    const p = buildUpdateProposal({
      kit,
      to: { version: 2, content: content() },
      versions: new Map([[1, v1]]),
      usage,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    expect(p.changes).toEqual([
      expect.objectContaining({ elementId: 'stage-01', fields: ['name'], kitChanged: false }),
    ]);
  });
});

describe('перенос выбранных изменений', () => {
  it('только выбранное; невыбранное остаётся на старой версии; связи и фрагменты', () => {
    const { v1, stages, risks, snapshot } = appliedProject();
    const usage = collectProjectKitUsage(stages, risks, snapshot).get('kit1')!;
    const to = { version: 2, content: v2() };
    const proposal = buildUpdateProposal({
      kit,
      to,
      versions: new Map([[1, v1]]),
      usage,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    const selected = new Set(['stage-01', 'stage-03', 'req-1', 'frag-1']);
    const calcPlan = planCalculationUpdate({
      kit,
      to,
      proposal,
      selected,
      usage,
      stages,
      risks,
      snapshot,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    expect(calcPlan.primary.map((p) => [p.name, p.hours, p.originRef])).toEqual([
      ['Ручной', 2, undefined],
      ['Монтаж', 14, 'kit:kit1@2#stage-01'],
      ['Шифрование каналов', 4, 'kit:kit1@2#stage-03'],
    ]);
    expect(calcPlan.primary[1].sourceStageId).toBe('S1'); // строка обновляется на месте
    expect(calcPlan.riskDeletes).toEqual([]); // удаление risk-01 не выбрано
    expect(calcPlan.riskUpdates).toEqual([]);

    const next = applySnapshotUpdate({
      kit,
      to,
      proposal,
      selected,
      snapshot,
      addPlan: calcPlan.addPlan,
      stageIdByElement: new Map([
        ['stage-01', 'S1'],
        ['stage-03', 'S3'],
      ]),
    });
    const reqs = next.requirements as Record<string, { kitVersion: number } | string>[];
    const r1 = reqs.find((r) => r.id === 'kit.siem.basic.req-1')!;
    expect(r1.title).toBe('Сбор и хранение');
    expect((r1.origin as { kitVersion: number }).kitVersion).toBe(2);
    const r2 = reqs.find((r) => r.id === 'kit.siem.basic.req-2')!;
    expect((r2.origin as { kitVersion: number }).kitVersion).toBe(2); // совпадал — перенесён
    expect(next.manualLinks).toContainEqual(
      expect.objectContaining({ sourceId: 'kit.siem.basic.req-2', targetId: 'S3' }),
    );
    expect(next.kitFragments!.map((f) => f.text)).toEqual(['А\nВ']);
    expect(snapshot.kitFragments!.map((f) => f.text)).toEqual(['А\nБ']); // исходный не тронут

    // Повторный дифф: остаётся только невыбранное удаление риска.
    const after = collectProjectKitUsage(
      [
        stages[0],
        { ...stages[1], name: 'Монтаж', hours: 14, originRef: 'kit:kit1@2#stage-01' },
        {
          id: 'S3',
          name: 'Шифрование каналов',
          role: 'engineer',
          hours: 4,
          requirements: null,
          isApprovalTask: false,
          originRef: 'kit:kit1@2#stage-03',
        },
      ],
      risks,
      next,
    ).get('kit1')!;
    const again = buildUpdateProposal({
      kit,
      to,
      versions: new Map([
        [1, v1],
        [2, to.content],
      ]),
      usage: after,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    expect(again.changes.map((c) => [c.elementId, c.kind])).toEqual([['risk-01', 'removed']]);
    expect(existingStateFor(after, next).stageIdByElement.get('stage-03')).toBe('S3');
  });

  it('удаление требования снимает его связи и проверки', () => {
    const { v1, stages, risks, snapshot } = appliedProject();
    const usage = collectProjectKitUsage(stages, risks, snapshot).get('kit1')!;
    const c = content();
    c.requirements = c.requirements.filter((r) => r.elementId !== 'req-1');
    c.stages[0].requirementIds = [];
    c.checks = c.checks.filter((x) => x.elementId !== 'chk-1');
    const to = { version: 2, content: c };
    const proposal = buildUpdateProposal({
      kit,
      to,
      versions: new Map([[1, v1]]),
      usage,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    const selected = new Set(['req-1']);
    const calcPlan = planCalculationUpdate({
      kit,
      to,
      proposal,
      selected,
      usage,
      stages,
      risks,
      snapshot,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    const next = applySnapshotUpdate({
      kit,
      to,
      proposal,
      selected,
      snapshot,
      addPlan: calcPlan.addPlan,
      stageIdByElement: new Map([['stage-01', 'S1']]),
    });
    const ids = (next.requirements as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain('kit.siem.basic.req-1');
    expect(next.manualLinks ?? []).toEqual([]);
    expect(next.kitChecks?.map((k) => k.origin.elementId)).toEqual(['chk-2']);
  });
});

describe('правки пользователя и снятые этапы', () => {
  it('пересчёт критериев не затирает критерий, исправленный пользователем', () => {
    const plan = buildApplicationPlan({
      kit,
      version: { version: 1, content: content() },
      selection: both,
      answers: {},
    });
    const { snapshot } = applyPlanToSnapshot({}, plan, new Map(), new Map());
    const reqs = snapshot.requirements as Record<string, unknown>[];
    reqs[0].criterion = 'Свой критерий';
    // Новая проверка на то же требование: автоматический критерий изменился бы.
    snapshot.kitChecks!.push({
      origin: { kitId: 'kit1', kitKey: 'siem.basic', kitVersion: 1, elementId: 'chk-x' },
      requirementIds: ['kit.siem.basic.req-1', 'kit.siem.basic.req-2'],
      criteria: 'Ещё',
      method: null,
    });
    recomputeKitCriteria(snapshot);
    expect(reqs[0].criterion).toBe('Свой критерий');
    // Исправленная строка главнее устаревшего списка: засев берёт её.
    expect(reqs[0].acceptanceCriteria).toBeUndefined();
    expect(reqs[1].acceptanceCriteria).toEqual(['TLS', 'Ещё']); // не правили — пересчитан
    expect(reqs[1].criterion).toBe('TLS; Ещё');
    // Список, исправленный пользователем (v2), тоже не затирается.
    reqs[1].acceptanceCriteria = ['Свой список'];
    recomputeKitCriteria(snapshot);
    expect(reqs[1].acceptanceCriteria).toEqual(['Свой список']);
    expect(extractCheckSeeds(snapshot).map((x) => [x.requirementId, x.criteria])).toEqual([
      ['kit.siem.basic.req-1', ['Свой критерий']],
      ['kit.siem.basic.req-2', ['Свой список']],
    ]);
  });

  it('связи на этапы, которых нет после перестройки, снимаются', () => {
    const { v1, stages, risks, snapshot } = appliedProject();
    snapshot.manualLinks = [
      ...(snapshot.manualLinks ?? []),
      { sourceId: 'manual', targetId: 'GONE', method: 'MANUAL', approved: true },
      { sourceId: 'decision', targetId: '', method: 'MANUAL', approved: true },
    ];
    const usage = collectProjectKitUsage(stages, risks, snapshot).get('kit1')!;
    const c = content();
    c.stages = c.stages.filter((x) => x.elementId !== 'stage-01');
    const to = { version: 2, content: c };
    const proposal = buildUpdateProposal({
      kit,
      to,
      versions: new Map([[1, v1]]),
      usage,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    expect(proposal.changes.find((x) => x.elementId === 'stage-01')?.kind).toBe('removed');
    const selected = new Set(['stage-01']);
    const calcPlan = planCalculationUpdate({
      kit,
      to,
      proposal,
      selected,
      usage,
      stages,
      risks,
      snapshot,
      driverValues: { sites: 1 },
      hasPackage: true,
    });
    expect(calcPlan.primary.map((p) => p.sourceStageId)).toEqual(['M']);
    const next = applySnapshotUpdate({
      kit,
      to,
      proposal,
      selected,
      snapshot,
      addPlan: calcPlan.addPlan,
      stageIdByElement: new Map(),
      liveStageIds: new Set(['M']),
    });
    expect((next.manualLinks ?? []).map((l) => (l as { sourceId: string }).sourceId)).toEqual([
      'decision',
    ]);
  });

  it('пустой план и разбор драйверов', () => {
    const plan = buildApplicationPlan({
      kit,
      version: { version: 1, content: content() },
      selection: { ...both, excluded: ['x'], targets: { calculation: false, package: true } },
      answers: {},
      existing: {
        presentElementIds: new Set(['req-1', 'req-2', 'chk-1', 'chk-2', 'frag-1']),
        stageIdByElement: new Map(),
        requirementIdByElement: new Map(),
        snapshotRequirementIds: new Set(),
      },
    });
    expect(isEmptyPlan(plan)).toBe(true);
    expect(parseDriverValues({ sites: 2 })).toEqual({ sites: 2 });
    expect(parseDriverValues({ sites: 1e7 })).toMatch(/sites/);
    expect(parseDriverValues([])).toMatch(/объект/);
  });
});

describe('дополнения разделов из наборов в документе', () => {
  const generated = (): Gost34Section =>
    ({
      id: 'tz2020-goals-purpose',
      numStr: '2.2',
      title: 'Назначение АС',
      paragraphs: ['2.2.1 Сгенерировано', '2.2.2 Ещё сгенерировано'],
    }) as unknown as Gost34Section;
  const fragments = [
    {
      origin: { kitId: 'k', kitKey: 'kk', kitVersion: 1, elementId: 'frag-1' },
      sectionKey: 'tz2020-goals-purpose',
      title: null,
      text: 'Из набора 1\nИз набора 2',
    },
  ];
  const build = (overrides: Record<string, { paragraphs?: string[] }>, tzAuthor?: unknown) =>
    applyKitAppendices(
      applySectionOverrides(
        [generated()],
        overlaysForDocument({
          docType: 'TZ',
          sectionOverrides: overrides,
          tzAuthor: tzAuthor as never,
        }),
      ),
      kitAppendicesFromFragments(fragments),
    )[0];

  it('дописываются после сгенерированного текста, нумерация продолжается, сгенерированное не перенумеровано', () => {
    const sec = build({});
    expect(sec.paragraphs).toEqual([
      '2.2.1 Сгенерировано',
      '2.2.2 Ещё сгенерировано',
      '2.2.3 Из набора 1',
      '2.2.4 Из набора 2',
    ]);
    expect(sec.kitAppendix).toEqual({ count: 2, elementIds: ['frag-1'] });
  });

  it('правка в студии: редактируются только свои абзацы, дополнения остаются и не дублируются', () => {
    const sec = build({});
    const editable = editableParagraphs(sec);
    expect(editable).toEqual(['2.2.1 Сгенерировано', '2.2.2 Ещё сгенерировано']);
    // Пользователь сохранил правку раздела (без дополнений) — как saveSectionEdit.
    const edited = build({ 'Назначение АС': { paragraphs: ['Своя формулировка'] } });
    expect(edited.paragraphs).toEqual([
      '2.2.1 Своя формулировка',
      '2.2.2 Из набора 1',
      '2.2.3 Из набора 2',
    ]);
  });

  it('сброс правки и перегенерация автором ТЗ сохраняют дополнения', () => {
    // Сброс: правки нет — сгенерированный текст и дополнения.
    expect(build({}).paragraphs.slice(-2)).toEqual(['2.2.3 Из набора 1', '2.2.4 Из набора 2']);
    // Перегенерация: принятая проза автора ТЗ заменяет текст раздела.
    const regenerated = build(
      {},
      {
        proposals: {
          p: { nodeId: 'tz2020-goals-purpose', status: 'ACCEPTED', paragraphs: ['Автор ТЗ'] },
        },
      },
    );
    expect(regenerated.paragraphs).toEqual([
      '2.2.1 Автор ТЗ',
      '2.2.2 Из набора 1',
      '2.2.3 Из набора 2',
    ]);
  });

  it('без нумерованного последнего абзаца дополнения печатаются без номера', () => {
    const sec = applyKitAppendices(
      [{ ...generated(), paragraphs: ['Вводный текст'] }],
      kitAppendicesFromFragments(fragments),
    )[0];
    expect(sec.paragraphs).toEqual(['Вводный текст', 'Из набора 1', 'Из набора 2']);
    expect(applyKitAppendices([generated()], {})[0]).toEqual(generated());
  });

  it('раздел фрагмента приводится к id схемы', () => {
    expect(resolveTzSectionId('tz2020-sources')).toBe('tz2020-sources');
    expect(resolveTzSectionId('scope')).toBe('tz2020-goals-purpose');
    expect(resolveTzSectionId('  назначение   ас ')).toBe('tz2020-goals-purpose');
    expect(resolveTzSectionId('нет такого')).toBeNull();
    const plan = buildApplicationPlan({
      kit,
      version: {
        version: 1,
        content: {
          ...content(),
          fragments: [
            {
              elementId: 'frag-x',
              sectionKey: 'нет такого',
              title: null,
              text: 'x',
              requirementIds: [],
            },
          ],
        },
      },
      selection: both,
      answers: {},
    });
    expect(plan.fragments).toEqual([]);
    expect(plan.skipped).toContainEqual({ elementId: 'frag-x', reason: 'unknown-section' });
  });
});

describe('нормализатор не трогает требования из наборов', () => {
  it('требования с origin проходят насквозь со служебными полями и на своих местах', async () => {
    const plan = buildApplicationPlan({
      kit,
      version: { version: 1, content: content() },
      selection: both,
      answers: {},
    });
    const { snapshot } = applyPlanToSnapshot({}, plan, new Map(), new Map());
    const kitReq = (snapshot.requirements as Gost34RequirementItem[])[0];
    const items: Gost34RequirementItem[] = [
      {
        id: 'a',
        code: '1',
        category: 'functional',
        title: 'система должна логировать',
        description: '- система должна логировать',
      },
      kitReq,
      {
        id: 'b',
        code: '2',
        category: 'security',
        title: 'шифрование',
        description: 'Система должна шифровать.',
      },
    ];
    const res = await normalizeRequirementsWithLlm(items, {
      provider: { id: 'x', label: 'x', endpoint: 'http://127.0.0.1:9', kind: 'ollama' },
    });
    expect(res.requirements[1]).toEqual(kitReq);
    expect(res.requirements[1]).toMatchObject({
      kitCriterion: 'Журналы поступают',
      acceptanceCriteria: ['Журналы поступают', 'В консоли'],
      verificationMethod: 'TEST',
    });
    expect(res.requirementsV2[1].source?.origin?.elementId).toBe('req-1');
    expect(res.requirementsV2[1].kitTracking?.criterion).toBe('Журналы поступают');
    // Адаптеры: v1 → v2 → v1 без потерь для требования из набора.
    expect(toGost34RequirementItem(fromGost34RequirementItem(kitReq))).toMatchObject({
      origin: kitReq.origin,
      acceptanceCriteria: kitReq.acceptanceCriteria,
      verificationMethod: 'TEST',
      kitCriterion: 'Журналы поступают',
      kitAutoCriteria: kitReq.kitAutoCriteria,
      kitAutoCriterion: kitReq.kitAutoCriterion,
      kitAutoMethod: 'TEST',
    });
  });
});
