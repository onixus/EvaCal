import { fromGost34RequirementItem } from '../requirements/adapters';
import { Gost34RequirementV2, getRequirementEffectiveText } from '../requirements/v2';
import { Gost34RequirementItem, Gost34StageItem, Gost34TableData } from '../types';
import { TraceLink, TraceabilityResult } from './types';
import { normalizeRoleKey } from '@/lib/roles';

/**
 * Ручное решение «требование намеренно не распределено»: связь без целевого
 * этапа. Такое требование остаётся UNMAPPED и не перепривязывается правилами.
 */
export function isUnmappedDecision(link: TraceLink): boolean {
  return !link.targetId;
}

export function buildTraceability(
  requirements: Gost34RequirementV2[],
  stages: Gost34StageItem[],
  manualLinks: TraceLink[] = [],
): TraceabilityResult {
  const stageIds = new Set(stages.map((stage) => stage.id));
  const requirementIds = new Set(requirements.map((req) => req.id));

  // Решения по удалённым требованиям не должны попадать в метрики покрытия.
  const decisions = manualLinks.filter((link) => requirementIds.has(link.sourceId));
  const rejectedRequirementIds = new Set(
    decisions.filter(isUnmappedDecision).map((link) => link.sourceId),
  );

  const links: TraceLink[] = decisions.filter((link) => stageIds.has(link.targetId));

  for (const req of requirements) {
    // Manual/pre-existing mappings are authoritative for this requirement.
    if (links.some((link) => link.sourceId === req.id)) continue;
    if (rejectedRequirementIds.has(req.id)) continue;

    const match = matchStageByRules(req, stages);
    if (match) {
      links.push({
        sourceId: req.id,
        targetId: match.id,
        method: 'RULE',
        confidence: 0.85,
        approved: false,
      });
    }
  }

  const mappedRequirements = new Set(links.map((l) => l.sourceId)).size;
  const totalRequirements = requirements.length;
  const unmappedRequirements = totalRequirements - mappedRequirements;
  const coveragePercentage =
    totalRequirements > 0 ? (mappedRequirements / totalRequirements) * 100 : 0;

  return {
    links,
    metrics: {
      totalRequirements,
      mappedRequirements,
      unmappedRequirements,
      coveragePercentage: Number(coveragePercentage.toFixed(2)),
    },
  };
}

/**
 * Smart multi-factor stage matcher for IT, Cybersecurity, Hardware/PAC, Software Supply, and Deployment.
 */
export function matchStageByRules(
  req: Gost34RequirementV2,
  stages: Gost34StageItem[],
): Gost34StageItem | null {
  if (!stages || stages.length === 0) return null;

  const reqText =
    `${req.code} ${req.title} ${getRequirementEffectiveText(req)} ${req.category || ''}`.toLowerCase();

  // Helper to match stage by combined text and role
  const findStage = (pattern: RegExp) =>
    stages.find((s) => pattern.test(`${s.name} ${s.role} ${s.requirements || ''}`)) || null;

  // 1. Поставка ПО и лицензий (Software Supply)
  if (
    /поставк.*по|лицензи|сублиценз|реестр.*(программ|по|минцифр|188-фз)|дистрибутив|сертификат.*подлинност|формуляр|ключ.*активац/i.test(
      reqText,
    ) &&
    !/пак|сервер|схд|коммутатор|стойк|шкаф|оборудован|желез/i.test(reqText)
  ) {
    const swStage = findStage(/поставк.*(по|программн|лиценз|софт)|закупк.*(по|лиценз)|лицензи/i);
    if (swStage) return swStage;
  }

  // 2. Информационная безопасность, СЗИ, СКЗИ, аттестация, ФСТЭК/ФСБ (Cybersecurity)
  if (
    req.category === 'security' ||
    /безопасн|иб|сзи|скзи|нсд|шифр|152-фз|187-фз|кии|фстэк|приказ.*(17|21|117|239)|фсб|282|378|гост-vpn|криптопро|vipnet|випнет|континент|соболь|secret net|секрет нет|dallas lock|даллас лок|usergate|юзергейт|kaspersky|касперск|cyberpeak|сайберпик|positive technologies|maxpatrol|pt nad|pt isim|межсетев.*экран|ngfw|waf|siem|edr|xdr|dlp|pam|hsm|аттестац|модель угроз|орд|авториз|прав.*доступ|разграничен.*прав/i.test(
      reqText,
    )
  ) {
    const secStage = findStage(/безопасн|защит|сзи|скзи|иб|аттестац|орд|инженер.*иб|security/i);
    if (secStage) return secStage;
  }

  // 3. Инфраструктура, монтаж, ПНР, ОС, СУБД, виртуализация (Infra & Setup)
  if (
    req.category === 'infra_setup' ||
    /монтаж|пнр|пусконалад|настройк.*ос|установк.*ос|astra linux|астра линукс|ред ос|альт линукс|базальт|ubuntu|rhel|debian|субд|баз.*данн|postgresql|postgres pro|постгрес|sqlite|oracle|clickhouse|redis|виртуализац|zvirt|vmmanager|openstack|kubernetes|k8s|docker|openshift|proxmox|freeipa|active directory|ldap|dns|dhcp|резервн.*копирован|бэкап|киберпротект|rubackup|veeam/i.test(
      reqText,
    )
  ) {
    const infraStage =
      findStage(
        /монтаж|пнр|пусконалад|инфраструктур|настройк\s+(ос|сервер|субд|бд|виртуализ|кластер|баз|сетев)|развертыван|установк\s+(ос|субд|платформ)|(баз.*данн|субд|бд|кластер|виртуализ|postgres|астра|astra)/i,
      ) || findStage(/бд|субд|баз.*данн|хранилищ|кластер|dba/i);
    if (infraStage) return infraStage;
  }

  // 4. Поставка оборудования, серверов, СХД, сети, ПАК (Hardware & PAC)
  if (
    req.category === 'hardware_pac' ||
    /пак|программно-аппаратн|сервер|схд|оборудован|стойк|шкаф|коммутатор|маршрутизатор|ибп|apc|yadro|аквариус|aquarius|fplus|скала|depo|гравитон|kraftway|qtech|eltex|cisco|huawei|dell|hpe|lenovo|supermicro|san|nas|raid|jbod|nvme|sas|sata|ipmi|ilo|idrac|bmc|скс|волс|зип/i.test(
      reqText,
    )
  ) {
    const hwStage = findStage(
      /поставк.*(оборудован|желез|пак|сервер|схд|сет)|монтаж.*(пак|сервер|схд|шкаф|стойк|оборудован)|аппаратн|оборудован|сборк.*пак/i,
    );
    if (hwStage) return hwStage;
  }

  // 5. Интеграции, API, шины данных (Integration)
  if (
    req.category === 'integration' ||
    /интеграц|api|шлюз|rest|soap|graphql|grpc|kafka|rabbitmq|1с|1c|смэв|еаис|егисз|есиа|esb|etl|обмен.*данн|протокол.*взаимодейств|внешн.*систем/i.test(
      reqText,
    )
  ) {
    const intStage = findStage(/интеграц|api|шлюз|обмен.*данн|1с|смэв|kafka|разработ|архитект/i);
    if (intStage) return intStage;
  }

  // 6. Проектирование и архитектура (Architecture)
  if (
    /архитектур|проектирован|техпроект|технический проект|эскизный проект|схема.*бд|концепци|гап|структур.*систем/i.test(
      reqText,
    )
  ) {
    const archStage = findStage(
      /проектирован|архитектур|техпроект|технический проект|концепц|архитект/i,
    );
    if (archStage) return archStage;
  }

  // 7. Пользовательский интерфейс, веб, эргономика (UI / Frontend)
  if (/интерфейс|веб|дизайн|экран|форма|wcag|доступност|52872/i.test(reqText)) {
    const uiStage = findStage(/интерфейс|фронт|разработ|дизайн/i);
    if (uiStage) return uiStage;
  }

  // 8. Испытания, ПМИ, приёмка (Testing & Acceptance)
  if (
    req.category === 'testing_acceptance' ||
    /испытан|пми|программ.*методик.*испытан|приемк|приемо-сдаточн|автономн.*испытан|комплексн.*испытан|предварительн.*испытан|опытн.*эксплуатац|тестирован|нагрузочн.*тест/i.test(
      reqText,
    )
  ) {
    const pmiStage = findStage(/тест|испытан|приемк|пми|аналитик|инженер/i);
    if (pmiStage) return pmiStage;
  }

  // 9. Обучение, регламенты, эксплуатационная документация (Training & Support)
  if (
    req.category === 'training_support' ||
    /обучен|персонал|пользовател|руководств.*пользовател|руководств.*оператор|руководств.*администратор|паспорт.*систем|регламент|эксплуатационн.*документац|техподдержк|сопровожден|гаранти/i.test(
      reqText,
    )
  ) {
    const trainStage = findStage(
      /обучен|инструктаж|документац|руководств|сопровожден|техподдержк|аналитик|консультант/i,
    );
    if (trainStage) return trainStage;
  }

  // 10. Прикладная разработка и функционал
  if (
    /разработк.*модул|функционал|бизнес-логик|пользовательск.*сценари|кастомизац/i.test(reqText)
  ) {
    const devStage = findStage(/разработк|программирован|реализац.*функционал|разработчик/i);
    if (devStage) return devStage;
  }

  // An unmatched requirement remains explicitly UNMAPPED.
  return null;
}

type TraceabilityRequirement = Gost34RequirementV2 | Gost34RequirementItem;

function isRequirementV2(requirement: TraceabilityRequirement): requirement is Gost34RequirementV2 {
  return 'approval' in requirement && typeof requirement.approval === 'object';
}

function normalizeRequirements(requirements: TraceabilityRequirement[]): Gost34RequirementV2[] {
  return requirements.map((requirement) =>
    isRequirementV2(requirement) ? requirement : fromGost34RequirementItem(requirement),
  );
}

function legacyManualLinks(
  requirements: TraceabilityRequirement[],
  stages: Gost34StageItem[],
): TraceLink[] {
  const stageIds = new Set(stages.map((stage) => stage.id));

  return requirements.flatMap((requirement) => {
    if (isRequirementV2(requirement)) return [];
    if (!requirement.mappedStageId || !stageIds.has(requirement.mappedStageId)) return [];

    return [
      {
        sourceId: requirement.id,
        targetId: requirement.mappedStageId,
        method: 'MANUAL' as const,
        confidence: 1,
        approved: true,
      },
    ];
  });
}

export function generateTraceabilityTable(
  requirements: TraceabilityRequirement[],
  stages: Gost34StageItem[],
  result?: TraceabilityResult,
): Gost34TableData {
  const normalizedRequirements = normalizeRequirements(requirements);
  const resolvedResult =
    result ??
    buildTraceability(normalizedRequirements, stages, legacyManualLinks(requirements, stages));

  const rows: (string | number)[][] = [];

  for (const req of normalizedRequirements) {
    const link = resolvedResult.links.find((l) => l.sourceId === req.id);
    const stage = link ? stages.find((s) => s.id === link.targetId) : null;

    rows.push([
      req.code,
      req.title,
      stage ? stage.name : '[НЕ РАСПРЕДЕЛЕНО]',
      stage ? stage.role : '',
      req.source?.filename || 'ТЗ',
    ]);
  }

  return {
    caption: 'Матрица прослеживаемости требований и этапов проекта',
    headers: [
      'Код требования',
      'Вендорское требование',
      'Ответственный этап работ',
      'Роль исполнителя',
      'Источник',
    ],
    rows,
  };
}
