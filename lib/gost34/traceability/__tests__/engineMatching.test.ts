import { describe, expect, it } from 'vitest';
import { buildTraceability } from '../engine';
import { resolveGostSection, resolvePmiTest } from '../matrix';
import { Gost34RequirementItem, Gost34StageItem } from '../../types';
import { fromGost34RequirementItems } from '../../requirements';

describe('Intelligent Domain Matching & GOST Section Distribution', () => {
  const mockStages: Gost34StageItem[] = [
    {
      id: 'stage_hw_supply',
      order: 1,
      name: 'Поставка серверного оборудования, СХД и ПАК YADRO/Аквариус',
      role: 'engineer',
      hours: 40,
    },
    {
      id: 'stage_sw_supply',
      order: 2,
      name: 'Поставка программного обеспечения и лицензий из Единого реестра ПО',
      role: 'pm',
      hours: 16,
    },
    {
      id: 'stage_infra_setup',
      order: 3,
      name: 'Монтаж в стойку, ПНР и установка ОС Astra Linux и СУБД Postgres Pro',
      role: 'engineer',
      hours: 60,
    },
    {
      id: 'stage_sec_setup',
      order: 4,
      name: 'Внедрение средств защиты информации (СЗИ/СКЗИ), UserGate NGFW, Kaspersky и Cyberpeak',
      role: 'engineer',
      hours: 80,
    },
    {
      id: 'stage_api_dev',
      order: 5,
      name: 'Разработка интеграционных шлюзов REST API и шины Kafka с 1С',
      role: 'developer',
      hours: 120,
    },
    {
      id: 'stage_arch_design',
      order: 6,
      name: 'Разработка технического проекта и архитектурных решений (ГАП)',
      role: 'architect',
      hours: 50,
    },
    {
      id: 'stage_pmi_testing',
      order: 7,
      name: 'Проведение приемо-сдаточных испытаний по ПМИ',
      role: 'analyst',
      hours: 30,
    },
    {
      id: 'stage_training',
      order: 8,
      name: 'Обучение персонала и передача эксплуатационной документации',
      role: 'consultant',
      hours: 24,
    },
  ];

  const mockRequirements: Gost34RequirementItem[] = [
    {
      id: 'req_hw_1',
      code: 'ТР-ПАК-01',
      category: 'hardware_pac',
      title: 'Серверная платформа и СХД YADRO Tatlin Unified',
      description: 'Поставка программно-аппаратного комплекса (ПАК) в составе 2-х серверов 2U и дисковой полки NVMe/SAS.',
    },
    {
      id: 'req_sw_1',
      code: 'ТР-ПО-01',
      category: 'software_supply',
      title: 'Лицензии из Единого реестра российских программ (188-ФЗ)',
      description: 'Поставка бессрочных сублицензий на системное ПО с формулярами и сертификатами подлинности.',
    },
    {
      id: 'req_sec_1',
      code: 'ТР-ИБ-01',
      category: 'security',
      title: 'Межсетевое экранирование UserGate и защита конечных точек Kaspersky',
      description: 'Система должна обеспечивать фильтрацию трафика NGFW UserGate и антивирусную защиту Kaspersky Endpoint Security по требованиям ФСТЭК № 21.',
    },
    {
      id: 'req_sec_2',
      code: 'ТР-ИБ-02',
      category: 'security',
      title: 'Аудит файловых хранилищ Cyberpeak и криптографическая защита ViPNet',
      description: 'Внедрение системы аудита доступа к неструктурированным данным Cyberpeak и ГОСТ-VPN шлюзов ViPNet Coordinator.',
    },
    {
      id: 'req_infra_1',
      code: 'ТР-ИНФРА-01',
      category: 'infra_setup',
      title: 'Развертывание защищенной ОС Astra Linux SE и СУБД Postgres Pro Enterprise',
      description: 'Монтаж в стойку 42U, пусконаладочные работы (ПНР) и отказоустойчивая кластеризация СУБД Postgres Pro.',
    },
    {
      id: 'req_api_1',
      code: 'ТР-ИНТ-01',
      category: 'integration',
      title: 'Интеграция с 1С:ERP через брокер сообщений Apache Kafka и REST API',
      description: 'Реализация асинхронного обмена справочниками и документами с гарантированной доставкой.',
    },
    {
      id: 'req_arch_1',
      code: 'ТР-АРХ-01',
      category: 'technical',
      title: 'Архитектурное проектирование системы и Технический проект (ГАП)',
      description: 'Разработка рабочей конструкторской документации и Технического проекта по ГОСТ 34.201.',
    },
    {
      id: 'req_pmi_1',
      code: 'ТР-ПМИ-01',
      category: 'testing_acceptance',
      title: 'Программа и методика приемо-сдаточных испытаний (ПМИ)',
      description: 'Проведение автономных и комплексных приемочных испытаний в соответствии с ГОСТ 34.603.',
    },
  ];

  it('correctly maps domain requirements to respective GOST 34 sections', () => {
    // Hardware & PAC -> 4.3.2
    const hwSec = resolveGostSection(mockRequirements[0]);
    expect(hwSec.code).toBe('4.3.2');
    expect(hwSec.title).toContain('аппаратному составу и ПАК');

    // Software Supply -> 4.3.1
    const swSec = resolveGostSection(mockRequirements[1]);
    expect(swSec.code).toBe('4.3.1');
    expect(swSec.title).toContain('программному обеспечению');

    // Cybersecurity (UserGate, Kaspersky, Cyberpeak, ViPNet) -> 4.1.2
    const sec1 = resolveGostSection(mockRequirements[2]);
    expect(sec1.code).toBe('4.1.2');
    expect(sec1.title).toContain('защите информации');

    const sec2 = resolveGostSection(mockRequirements[3]);
    expect(sec2.code).toBe('4.1.2');

    // Infrastructure & Installation -> 4.1.5
    const infraSec = resolveGostSection(mockRequirements[4]);
    expect(infraSec.code).toBe('4.1.5');
    expect(infraSec.title).toContain('эксплуатации');

    // API Integration -> 4.1.6
    const apiSec = resolveGostSection(mockRequirements[5]);
    expect(apiSec.code).toBe('4.1.6');
    expect(apiSec.title).toContain('интеграционным интерфейсам');

    // PMI -> 6.1
    const pmiSec = resolveGostSection(mockRequirements[7]);
    expect(pmiSec.code).toBe('6.1');
    expect(pmiSec.title).toContain('контроля и приемки');
  });

  it('generates rich, domain-specific PMI test procedures', () => {
    // PAC Hardware PMI test
    const pmiHw = resolvePmiTest(mockRequirements[0], 1);
    expect(pmiHw.testCode).toContain('ПАК');
    expect(pmiHw.method).toContain('IPMI/BMC');

    // Software Supply PMI test
    const pmiSw = resolvePmiTest(mockRequirements[1], 2);
    expect(pmiSw.testCode).toContain('ЛИЦ');
    expect(pmiSw.method).toContain('формуляров');

    // Security PMI test
    const pmiSec = resolvePmiTest(mockRequirements[2], 3);
    expect(pmiSec.testCode).toContain('ИБ');
    expect(pmiSec.method).toContain('сканирование сетевых портов');
  });

  it('intelligently matches requirements to stages with high accuracy and 100% coverage', () => {
    const v2Reqs = fromGost34RequirementItems(mockRequirements);
    const traceResult = buildTraceability(v2Reqs, mockStages);

    expect(traceResult.metrics.totalRequirements).toBe(8);
    expect(traceResult.metrics.mappedRequirements).toBe(8);
    expect(traceResult.metrics.unmappedRequirements).toBe(0);
    expect(traceResult.metrics.coveragePercentage).toBe(100);

    const getTargetStageId = (reqCode: string) => {
      const req = v2Reqs.find((r) => r.code === reqCode);
      const link = traceResult.links.find((l) => l.sourceId === req?.id);
      return link?.targetId;
    };

    // Hardware PAC matches hardware supply stage
    expect(getTargetStageId('ТР-ПАК-01')).toBe('stage_hw_supply');

    // Software supply matches software supply stage
    expect(getTargetStageId('ТР-ПО-01')).toBe('stage_sw_supply');

    // UserGate / Kaspersky security matches security setup stage
    expect(getTargetStageId('ТР-ИБ-01')).toBe('stage_sec_setup');
    expect(getTargetStageId('ТР-ИБ-02')).toBe('stage_sec_setup');

    // Astra Linux & Postgres Pro infra setup matches infra setup stage
    expect(getTargetStageId('ТР-ИНФРА-01')).toBe('stage_infra_setup');

    // API & Kafka integration matches API development stage
    expect(getTargetStageId('ТР-ИНТ-01')).toBe('stage_api_dev');

    // Architecture & GAP matches architecture design stage
    expect(getTargetStageId('ТР-АРХ-01')).toBe('stage_arch_design');

    // PMI testing matches testing stage
    expect(getTargetStageId('ТР-ПМИ-01')).toBe('stage_pmi_testing');
  });
});
