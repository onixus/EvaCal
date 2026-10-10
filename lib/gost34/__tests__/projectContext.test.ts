import { describe, it, expect } from 'vitest';
import { buildProjectContext, hasBlockingGaps } from '../context/builder';
import { analyzeAndNormalizeInput } from '../analyzer';
import { ContextGap } from '../context/types';

function gapPaths(gaps: ContextGap[] | undefined): string[] {
  return (gaps || []).map((g) => g.path);
}

describe('buildProjectContext: пустой опросник', () => {
  const ctx = buildProjectContext({ answers: {}, stages: [] });

  it('не выдумывает значения, которых нет в источниках', () => {
    expect(ctx.automationObject).toBeUndefined();
    expect(ctx.systemPurpose).toBeUndefined();
    expect(ctx.availability).toBeUndefined();
    expect(ctx.infrastructure).toBeUndefined();
  });

  it.each(['automationObject', 'systemPurpose', 'goals', 'availability', 'security', 'lifecycle'])(
    'фиксирует пробел «%s»',
    (path) => {
      expect(gapPaths(ctx.gaps)).toContain(path);
    },
  );

  it('сообщает о блокирующих пробелах', () => {
    expect(hasBlockingGaps(ctx)).toBe(true);
  });
});

describe('buildProjectContext: маппинг опросника и расчёта', () => {
  const ctx = buildProjectContext({
    answers: {
      users_count: 250,
      integrations_count: 4,
      screens_count: 30,
      complexity: 'высокая',
      deployment: 'Локально в ЦОД Заказчика',
      platforms: 'Astra Linux; PostgreSQL 16',
      персональные_данные: 'да',
      availability_sla: '99.5',
      rto: '60',
      rpo: '15',
    },
    stages: [
      {
        id: 's1',
        order: 1,
        name: 'Обследование',
        role: 'аналитик',
        hours: 40,
        startDate: '01.09.2026',
      },
      {
        id: 's2',
        order: 2,
        name: 'Внедрение',
        role: 'инженер',
        hours: 80,
        endDate: '20.12.2026',
      },
    ],
    totalLaborHours: 120,
  });

  it('переносит ответы опросника в соответствующие поля контекста', () => {
    expect(ctx.users?.[0]?.approximateCount).toBe(250);
    expect(ctx.deploymentModel).toBe('on-premise');
    expect(ctx.infrastructure?.platforms).toEqual(['Astra Linux', 'PostgreSQL 16']);
    expect(ctx.security?.personalDataProcessed).toBe(true);
    expect(ctx.availability).toEqual({
      availabilityTargetPercent: 99.5,
      rtoMinutes: 60,
      rpoMinutes: 15,
    });
  });

  it('берёт жизненный цикл из расчёта', () => {
    expect(ctx.lifecycle?.stages).toEqual(['Обследование', 'Внедрение']);
    expect(ctx.lifecycle?.totalLaborHours).toBe(120);
  });

  it('по одному только количеству интеграций не придумывает смежные системы', () => {
    expect(ctx.integrations).toBeUndefined();
    expect(gapPaths(ctx.gaps)).toContain('integrations');
    expect(ctx.architecture?.notes?.join(' ')).toContain('4');
  });

  it('фиксирует провенанс значений', () => {
    expect(ctx.provenance).toContainEqual({
      path: 'availability.rtoMinutes',
      source: 'questionnaire',
      evidence: 'rto',
    });
  });
});

describe('buildProjectContext: ручной ввод', () => {
  const ctx = buildProjectContext({
    answers: { users_count: 10 },
    stages: [],
    override: {
      systemPurpose: 'Учёт договоров лизинга',
      availability: {
        availabilityTargetPercent: 99.9,
        rtoMinutes: 30,
        rpoMinutes: 5,
      },
    },
  });

  it('перекрывает выведенные значения', () => {
    expect(ctx.systemPurpose).toBe('Учёт договоров лизинга');
    expect(ctx.availability?.rtoMinutes).toBe(30);
  });

  it('снимает соответствующие пробелы и помечается источником manual', () => {
    expect(gapPaths(ctx.gaps)).not.toContain('systemPurpose');
    expect(gapPaths(ctx.gaps)).not.toContain('availability');
    expect(ctx.provenance).toContainEqual({
      path: 'systemPurpose',
      source: 'manual',
      evidence: 'override',
    });
  });
});

describe('analyzeAndNormalizeInput', () => {
  const payload = analyzeAndNormalizeInput({
    calculation: {
      id: 'calc-ctx',
      name: 'АС учёта заявок',
      customer: 'ПАО Пример',
      answers: JSON.stringify({ users_count: 80 }),
      stages: [
        {
          id: 's1',
          order: 1,
          name: 'Разработка',
          role: 'разработчик',
          hours: 100,
        },
      ],
    },
    projectContext: { automationObject: 'Процессы обработки заявок абонентов' },
  });

  it('прикладывает ProjectContext к payload и учитывает ручной ввод', () => {
    expect(payload.projectContext?.automationObject).toBe('Процессы обработки заявок абонентов');
    expect(payload.projectContext?.users?.[0]?.approximateCount).toBe(80);
  });
});

describe('buildProjectContext: автоматическое обогащение из отраслевых пресетов', () => {
  it('не подставляет бренды NGFW / СЗИ по количественным ответам опросника', () => {
    const ctx = buildProjectContext({
      answers: {
        ngfw_clusters_count: 2,
        endpoints_count: 150,
        storage_audits_count: 4,
        vpn_tunnels_count: 6,
      },
      stages: [{ id: 's1', order: 1, name: 'Внедрение NGFW', role: 'engineer', hours: 80 }],
    });

    expect(ctx.infrastructure?.platforms).toBeUndefined();
    expect(ctx.infrastructure?.importSubstitution).toBeUndefined();
    expect(ctx.gaps?.some((g) => g.path === 'infrastructure.platforms')).toBe(true);
    expect(ctx.infrastructure?.computeResources).toBe('количество кластеров NGFW по опроснику — 2');
    expect(ctx.infrastructure?.computeResources).not.toMatch(/UserGate|Kaspersky|Cyberpeak/);
    expect(ctx.security?.personalDataProcessed).toBeUndefined();
    expect(ctx.security?.regulatoryScope).toBeUndefined();
    expect(ctx.security?.securityClass).toBeUndefined();
    expect(ctx.availability?.availabilityTargetPercent).toBe(99.9);
  });

  it('для отдельного NGFW использует vendor-neutral контекст и не выдумывает ПДн/КИИ', () => {
    const ctx = buildProjectContext({
      answers: {
        ngfw_clusters_count: 2,
        network_zones_count: 8,
        rules_count: 300,
        internet_throughput_gbps: 4,
        east_west_throughput_gbps: 6,
        capacity_headroom_percent: 30,
        ngfw_ha_required: true,
        availability_target_percent: 99.99,
      },
      stages: [{ id: 's1', order: 1, name: 'Развертывание NGFW', role: 'engineer', hours: 80 }],
    });

    expect(ctx.infrastructure?.platforms).toContain(
      'NGFW-платформа для межсетевого экранирования, сегментации и сервисов L7',
    );
    expect(ctx.infrastructure?.platforms?.join(' ')).not.toContain('Kaspersky');
    expect(ctx.infrastructure?.platforms?.join(' ')).not.toContain('Cyberpeak');
    expect(ctx.infrastructure?.computeResources).toContain('4 узлов NGFW');
    expect(ctx.infrastructure?.computeResources).toContain('целевая производительность');
    expect(ctx.security?.personalDataProcessed).toBeUndefined();
    expect(ctx.security?.regulatoryScope).toBeUndefined();
    expect(ctx.availability?.availabilityTargetPercent).toBe(99.99);
  });

  it('различает полный и legacy SIEM при построении контекста', () => {
    const full = buildProjectContext({
      answers: {
        event_sources_count: 100,
        eps_estimate: 5000,
        eps_peak_factor: 2,
        avg_event_size_bytes: 800,
        hot_retention_days: 30,
        correlation_rules_count: 20,
        siem_platform: 'Определить по результатам пилота',
      },
      stages: [],
    });
    const legacy = buildProjectContext({
      answers: {
        event_sources_count: 100,
        eps_estimate: 5000,
        siem_platform: 'Определить по результатам пилота',
      },
      stages: [],
    });

    expect(full.infrastructure?.platforms).toEqual([
      'SIEM-платформа (выбор подтверждается по результатам пилота/обследования)',
    ]);
    expect(full.infrastructure?.computeResources).toContain('проектный пик 10000 EPS');
    expect(full.infrastructure?.importSubstitution).toBeUndefined();

    expect(legacy.infrastructure?.platforms).toBeUndefined();
    expect(legacy.infrastructure?.importSubstitution).toBeUndefined();
    expect(legacy.gaps?.some((g) => g.path === 'infrastructure.platforms')).toBe(true);
  });

  it('строит IDM-контекст из нового пресейл-опросника', () => {
    const ctx = buildProjectContext({
      answers: {
        identities_count: 120000,
        target_systems_count: 35,
        jml_events_per_day: 500,
        idm_ha_required: true,
        directory_platform: 'ALD Pro',
        availability_target_percent: 99.9,
      },
      stages: [],
    });

    expect(ctx.infrastructure?.platforms).toContain(
      'IDM / IGA-платформа управления жизненным циклом идентичностей и доступа',
    );
    expect(ctx.infrastructure?.platforms).toContain('Служба каталога: ALD Pro');
    expect(ctx.infrastructure?.computeResources).toContain(
      'не менее 3 логических прикладных узлов',
    );
    expect(ctx.performance?.dataVolume).toContain('120000 идентичностей');
  });

  it('не подставляет бренды ПАК и СУБД по количеству серверов', () => {
    const ctx = buildProjectContext({
      answers: {
        servers_count: 6,
        racks_count: 2,
        db_clusters_count: 2,
        datacenter_count: 1,
      },
      stages: [{ id: 's1', order: 1, name: 'ПНР ПАК', role: 'engineer', hours: 100 }],
    });

    expect(ctx.infrastructure?.platforms).toBeUndefined();
    expect(ctx.infrastructure?.importSubstitution).toBeUndefined();
    expect(ctx.infrastructure?.computeResources).toBe(
      'количество серверов по опроснику — 6, количество стоек — 2',
    );
    const infraGaps = (ctx.gaps || []).map((g) => g.path);
    expect(infraGaps).toContain('infrastructure.platforms');
    expect(infraGaps).toContain('infrastructure.computeResources');
    expect(ctx.availability?.availabilityTargetPercent).toBe(99.9);
    expect(ctx.availability?.rtoMinutes).toBe(15);
    expect(ctx.availability?.rpoMinutes).toBe(5);
  });

  it('не выдумывает количество стоек и сохраняет нулевое количество', () => {
    const missing = buildProjectContext({ answers: { servers_count: 4 }, stages: [] });
    expect(missing.infrastructure?.computeResources).toBe('количество серверов по опроснику — 4');
    expect(missing.infrastructure?.computeResources).not.toContain('стойк');

    const zero = buildProjectContext({ answers: { servers_count: 0 }, stages: [] });
    expect(zero.infrastructure?.computeResources).toBe('количество серверов по опроснику — 0');
  });

  it('для NGFW без HA и с неполным sizing фиксирует пробел вместо умолчаний', () => {
    const ctx = buildProjectContext({
      answers: {
        ngfw_clusters_count: 1,
        ngfw_ha_required: false,
        internet_throughput_gbps: 1,
      },
      stages: [],
    });
    expect(ctx.infrastructure?.computeResources).toContain('1 узлов NGFW');
    expect(ctx.infrastructure?.computeResources).not.toContain('целевая производительность');
    const sizingGap = ctx.gaps?.find((g) => g.label === 'Параметры sizing NGFW');
    expect(sizingGap?.hint).toContain('East-West');
  });
});

describe('buildProjectContext: цели и измеримые критерии из опросника', () => {
  it('извлекает цели и критерии, снимая соответствующие пробелы', () => {
    const ctx = buildProjectContext({
      answers: {
        project_goals: 'Сократить время обработки заявок; Повысить прозрачность процессов',
        goal_criteria:
          'Время обработки заявки = не более 15 мин; Доля автоматизированных операций = 80 %',
      },
      stages: [],
    });

    expect(ctx.goals?.map((g) => g.statement)).toEqual([
      'Сократить время обработки заявок',
      'Повысить прозрачность процессов',
    ]);
    expect(ctx.measurableGoalCriteria).toEqual([
      { metric: 'Время обработки заявки', target: 'не более 15 мин' },
      { metric: 'Доля автоматизированных операций', target: '80 %' },
    ]);
    const paths = (ctx.gaps || []).map((g) => g.path);
    expect(paths).not.toContain('goals');
    expect(paths).not.toContain('measurableGoalCriteria');
  });

  it('не принимает ключ критериев за цели', () => {
    const ctx = buildProjectContext({
      answers: { goal_criteria: 'Время отклика = 1 с' },
      stages: [],
    });
    expect(ctx.goals).toBeUndefined();
    expect((ctx.gaps || []).map((g) => g.path)).toContain('goals');
    expect(ctx.measurableGoalCriteria).toEqual([{ metric: 'Время отклика', target: '1 с' }]);
  });
});
