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
  it('обогащает контекст ГОСТ 34 спецификацией NGFW / СЗИ (UserGate, Kaspersky, Cyberpeak, ViPNet)', () => {
    const ctx = buildProjectContext({
      answers: {
        ngfw_clusters_count: 2,
        endpoints_count: 150,
        storage_audits_count: 4,
        vpn_tunnels_count: 6,
      },
      stages: [{ id: 's1', order: 1, name: 'Внедрение NGFW', role: 'engineer', hours: 80 }],
    });

    expect(ctx.infrastructure?.platforms).toContain('Межсетевые экраны NGFW UserGate в отказоустойчивом кластере HA');
    expect(ctx.infrastructure?.platforms).toContain('СЗИ от вредоносного ПО Kaspersky Endpoint Security');
    expect(ctx.infrastructure?.platforms).toContain('Система аудита доступа к неструктурированным данным Cyberpeak');
    expect(ctx.infrastructure?.platforms).toContain('СКЗИ ViPNet Coordinator HW (ГОСТ-VPN)');
    expect(ctx.infrastructure?.computeResources).toContain('2 кластеров аппаратных платформ UserGate NGFW');
    expect(ctx.security?.personalDataProcessed).toBe(true);
    expect(ctx.security?.regulatoryScope).toContain('187-ФЗ «О безопасности КИИ РФ»');
    expect(ctx.availability?.availabilityTargetPercent).toBe(99.9);
  });

  it('обогащает контекст ГОСТ 34 спецификацией ПАК и СУБД (YADRO, Astra Linux, Postgres Pro)', () => {
    const ctx = buildProjectContext({
      answers: {
        servers_count: 6,
        racks_count: 2,
        db_clusters_count: 2,
        datacenter_count: 1,
      },
      stages: [{ id: 's1', order: 1, name: 'ПНР ПАК', role: 'engineer', hours: 100 }],
    });

    expect(ctx.infrastructure?.platforms).toContain('Серверные платформы отечественного производства YADRO Vegman / Аквариус');
    expect(ctx.infrastructure?.platforms).toContain('Защищенная ОС Astra Linux Special Edition');
    expect(ctx.infrastructure?.platforms).toContain('СУБД Postgres Pro Enterprise (отказоустойчивый кластер)');
    expect(ctx.infrastructure?.computeResources).toBe('6 серверных платформ в 2 стойках 42U с резервированием по питанию и подключением к SAN/LAN');
    expect(ctx.availability?.availabilityTargetPercent).toBe(99.9);
    expect(ctx.availability?.rtoMinutes).toBe(15);
    expect(ctx.availability?.rpoMinutes).toBe(5);
  });
});
