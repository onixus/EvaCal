import { Gost34RequirementItem, Gost34StageItem } from '../types';
import {
  Gost34RequirementV2,
  fromGost34RequirementItem,
  getRequirementEffectiveText,
} from '../requirements';
import { buildTraceability } from './engine';
import { TraceLink } from './types';
import { roleLabel } from '@/lib/roles';

export interface TraceabilityMatrixItem {
  id: string;
  code: string;
  category: string;
  title: string;
  description: string;
  sourceQuestion?: {
    fieldKey: string;
    label: string;
    answerValue: string;
  };
  gostSection: {
    code: string;
    title: string;
    docType: 'TZ' | 'TP' | 'PMI';
  };
  pmiTest: {
    testCode: string;
    testTitle: string;
    method: string;
    expectedResult: string;
  };
  stage?: {
    id: string;
    name: string;
    role: string;
    roleLabel: string;
  };
  mappingMethod: 'RULE' | 'MANUAL' | 'LLM' | 'UNMAPPED';
  status: 'covered' | 'unmapped';
}

export interface FullTraceabilityMatrix {
  items: TraceabilityMatrixItem[];
  metrics: {
    total: number;
    covered: number;
    unmapped: number;
    coveragePercent: number;
    byCategory: Record<string, { total: number; covered: number }>;
  };
}

/**
 * Maps a requirement category / keywords to the canonical GOST 34.602 section.
 */
export function resolveGostSection(req: { code: string; title: string; category?: string; description?: string }) {
  const text = `${req.code} ${req.title} ${req.description || ''} ${req.category || ''}`.toLowerCase();

  // 1. Информационная безопасность, СЗИ, СКЗИ, ФСТЭК, 152-ФЗ, КИИ -> п. 4.1.2
  if (
    /безопасн|иб|сзи|скзи|нсд|шифр|152-фз|187-фз|кии|фстэк|117|239|фсб|282|378|гост-vpn|криптопро|vipnet|континент|соболь|secret net|dallas lock|usergate|kaspersky|cyberpeak|positive technologies|maxpatrol|pt nad|ngfw|waf|siem|edr|xdr|dlp|pam|hsm|аттестац|модель угроз|орд/i.test(
      text,
    ) ||
    req.category === 'security'
  ) {
    return {
      code: '4.1.2',
      title: 'Требования к защите информации от несанкционированного доступа (ИБ)',
      docType: 'TZ' as const,
    };
  }

  // 2. Эксплуатация, ТО, ПНР, монтаж, пусконаладка, персонал, документация -> п. 4.1.5
  if (
    req.category === 'infra_setup' ||
    req.category === 'training_support' ||
    /эксплуатац|пнр|пусконалад|персонал|обучен|руководств|сопровожден|техподдержк|ремонт/i.test(
      text,
    )
  ) {
    return {
      code: '4.1.5',
      title: 'Требования к эксплуатации, техническому обслуживанию, ремонту и персоналу',
      docType: 'TZ' as const,
    };
  }

  // 3. Аппаратное обеспечение, серверы, СХД, сеть и ПАК -> п. 4.3.2
  if (
    req.category === 'hardware_pac' ||
    /пак|программно-аппаратн|сервер|схд|оборудован|стойк|шкаф|коммутатор|маршрутизатор|ибп|apc|yadro|аквариус|aquarius|fplus|скала|depo|гравитон|kraftway|qtech|eltex|cisco|huawei|dell|hpe|lenovo|supermicro|san|nas|raid|nvme|sas|ipmi|ilo|idrac|bmc|скс|зип/i.test(
      text,
    )
  ) {
    return {
      code: '4.3.2',
      title: 'Требования к техническому обеспечению, аппаратному составу и ПАК',
      docType: 'TZ' as const,
    };
  }

  // 4. Программное обеспечение, поставка ПО, лицензии, реестр ПО -> п. 4.3.1
  if (
    req.category === 'software_supply' ||
    req.category === 'software' ||
    /поставк.*по|лицензи|сублиценз|реестр.*(программ|по|188-фз)|дистрибутив|формуляр|astra linux|ред ос|альт линукс|postgres pro|postgresql|zvirt|vmmanager|киберпротект/i.test(
      text,
    )
  ) {
    return {
      code: '4.3.1',
      title: 'Требования к программному обеспечению и поставке ПО',
      docType: 'TZ' as const,
    };
  }

  // 5. Интеграции, API, шины данных -> п. 4.1.6
  if (
    req.category === 'integration' ||
    /интеграц|api|шлюз|rest|soap|graphql|grpc|kafka|rabbitmq|1с|1c|смэв|еаис|егисз|есиа|esb|etl|обмен.*данн|протокол/i.test(
      text,
    )
  ) {
    return {
      code: '4.1.6',
      title: 'Требования к информационной совместимости и интеграционным интерфейсам',
      docType: 'TZ' as const,
    };
  }

  // 6. Надежность, отказ, бэкапы, SLA -> п. 4.1.1
  if (
    /надежност|sla|отказоустойчив|rto|rpo|бэкап|резервн|сохранност|кластер/i.test(text) ||
    req.category === 'reliability'
  ) {
    return {
      code: '4.1.1',
      title: 'Требования к надежности, отказоустойчивости и сохранности информации',
      docType: 'TZ' as const,
    };
  }

  // 7. Производительность -> п. 4.1.4
  if (
    /производительн|нагрузк|tps|отклик|масштабируем|время реакц|пользовател/i.test(text) ||
    req.category === 'performance'
  ) {
    return {
      code: '4.1.4',
      title: 'Требования к производительности и временным характеристикам',
      docType: 'TZ' as const,
    };
  }

  // 8. Эргономика и интерфейсы -> п. 4.1.3
  if (
    /интерфейс|веб|доступност|wcag|экран|форма|дизайн|52872/i.test(text) ||
    req.category === 'ergonomics'
  ) {
    return {
      code: '4.1.3',
      title: 'Требования к эргономике, технической эстетике и доступности интерфейсов',
      docType: 'TZ' as const,
    };
  }

  // 9. Приемка и испытания -> п. 6.1
  if (/испытан|пми|приемк|протокол/i.test(text) || req.category === 'testing_acceptance') {
    return {
      code: '6.1',
      title: 'Порядок контроля и приемки системы',
      docType: 'TZ' as const,
    };
  }

  // По умолчанию: функции системы -> п. 4.2.1
  return {
    code: '4.2.1',
    title: 'Требования к функциям (задачам), выполняемым системой',
    docType: 'TZ' as const,
  };
}

/**
 * Generates corresponding PMI (ГОСТ 34.603) testing method and procedure.
 */
export function resolvePmiTest(req: { code: string; title: string; category?: string; description?: string }, idx: number) {
  const text = `${req.code} ${req.title} ${req.description || ''} ${req.category || ''}`.toLowerCase();
  const testNum = String(idx).padStart(2, '0');

  // ПАК и серверное оборудование
  if (/пак|сервер|схд|оборудован|стойк|коммутатор|ибп|raid|nvme|ipmi|ilo|idrac|bmc|yadro|аквариус|fplus/i.test(text) || req.category === 'hardware_pac') {
    return {
      testCode: `ПМИ-ПАК-${testNum}`,
      testTitle: `Проверка работоспособности аппаратных компонентов ПАК и серверного оборудования`,
      method: 'Визуальный контроль монтажа, проверка индикации, диагностика через IPMI/BMC, симуляция отказа блока питания и диска RAID',
      expectedResult: 'Оборудование инициализируется без ошибок, модули удаленного управления доступны, резервирование срабатывает штатно.',
    };
  }

  // Поставка ПО и лицензии
  if (/поставк.*по|лицензи|сублиценз|реестр.*(программ|по|188-фз)|дистрибутив|формуляр/i.test(text) || req.category === 'software_supply') {
    return {
      testCode: `ПМИ-ЛИЦ-${testNum}`,
      testTitle: `Проверка лицензионной чистоты, формуляров и контрольных сумм дистрибутивов ПО`,
      method: 'Сверка номеров лицензий, проверка сертификатов подлинности и формуляров, вычисление контрольных сумм дистрибутивов (ГОСТ Р 34.11 / SHA-256)',
      expectedResult: 'Лицензии успешно активированы, контрольные суммы соответствуют эталонным значениям из формуляра.',
    };
  }

  // ИБ и СЗИ
  if (/безопасн|иб|сзи|скзи|нсд|шифр|152-фз|187-фз|фстэк|фсб|usergate|kaspersky|cyberpeak|positive|vipnet|континент|secret net|dallas lock|криптопро/i.test(text) || req.category === 'security') {
    return {
      testCode: `ПМИ-ИБ-${testNum}`,
      testTitle: `Проверка подсистемы информационной безопасности, средств защиты (СЗИ/СКЗИ) и разграничения доступа`,
      method: 'Инструментальное сканирование сетевых портов, проверка блокировок межсетевого экрана (NGFW), аудит парольной политики, проверка неизменяемости журналов безопасности',
      expectedResult: 'Доступ предоставляется строго по ролевой матрице, попытки НСД блокируются и регистрируются в SIEM/журнале аудита.',
    };
  }

  // Интеграции и API
  if (/интеграц|api|шлюз|rest|soap|kafka|rabbitmq|1с|смэв/i.test(text) || req.category === 'integration') {
    return {
      testCode: `ПМИ-ИНТ-${testNum}`,
      testTitle: `Проверка корректности интеграционного взаимодействия по API и обработки сбоев`,
      method: 'Автоматизированный вызов эндпоинтов (REST/JSON/SOAP), передача тестовых пакетов, симуляция тайм-аута и разрыва канала связи',
      expectedResult: 'Пакеты данных передаются без потерь, при сбоях выполняется повторная очередь сообщений с логированием ошибок.',
    };
  }

  // Надежность и кластеризация
  if (/надежност|sla|отказоустойчив|rto|rpo|бэкап|резервн|кластер/i.test(text) || req.category === 'reliability') {
    return {
      testCode: `ПМИ-НАД-${testNum}`,
      testTitle: `Проверка механизмов кластеризации, горячего резервирования и восстановления из резервных копий`,
      method: 'Имитация аварийного отключения ведущего узла кластера, проверка времени переключения (RTO ≤ 15 мин) и целостности БД (RPO ≤ 5 мин)',
      expectedResult: 'Кластер автоматически переключает нагрузку на резервный узел без потери транзакций.',
    };
  }

  // Производительность и нагрузка
  if (/производительн|нагрузк|tps|отклик|масштабируем/i.test(text) || req.category === 'performance') {
    return {
      testCode: `ПМИ-НАГР-${testNum}`,
      testTitle: `Нагрузочное тестирование при пиковом числе одновременных пользователей и транзакций`,
      method: 'Генерация синтетической нагрузки (k6/JMeter) до достижения целевого профиля одновременных пользователей',
      expectedResult: 'Время отклика 95-го перцентиля не превышает 1.5 сек при 100% целевой нагрузке.',
    };
  }

  // По умолчанию: функциональная проверка
  return {
    testCode: `ПМИ-ФУНК-${testNum}`,
    testTitle: `Функциональная проверка сценария выполнения операции: ${req.title}`,
    method: 'Пошаговое выполнение пользовательского сценария в соответствии с Руководством оператора',
    expectedResult: 'Операция завершается успешно с формированием целевого результата и фиксацией в БД.',
  };
}

/**
 * Builds the complete end-to-end traceability matrix.
 */
export function buildFullTraceabilityMatrix(
  requirements: (Gost34RequirementV2 | Gost34RequirementItem)[],
  stages: Gost34StageItem[],
  answers: Record<string, unknown> = {},
  fields: { key: string; label: string }[] = [],
  manualLinks: TraceLink[] = [],
): FullTraceabilityMatrix {
  // Normalize requirements
  const normalizedReqs: Gost34RequirementV2[] = requirements.map((r) =>
    'approval' in r ? (r as Gost34RequirementV2) : fromGost34RequirementItem(r as Gost34RequirementItem),
  );

  // Run core matching engine
  const traceResult = buildTraceability(normalizedReqs, stages, manualLinks);
  const linksMap = new Map(traceResult.links.map((l) => [l.sourceId, l]));
  const stagesMap = new Map(stages.map((s) => [s.id, s]));

  // Build field mapping lookup
  const fieldKeyToField = new Map(fields.map((f) => [f.key, f]));

  const items: TraceabilityMatrixItem[] = [];
  const byCategory: Record<string, { total: number; covered: number }> = {};

  let index = 1;
  for (const req of normalizedReqs) {
    const link = linksMap.get(req.id);
    const stage = link ? stagesMap.get(link.targetId) : undefined;
    const isCovered = Boolean(stage);

    const category = req.category || 'functional';
    if (!byCategory[category]) {
      byCategory[category] = { total: 0, covered: 0 };
    }
    byCategory[category].total++;
    if (isCovered) byCategory[category].covered++;

    // Find if any questionnaire field relates to this requirement
    let sourceQuestion: TraceabilityMatrixItem['sourceQuestion'];
    for (const [key, val] of Object.entries(answers)) {
      if (val === undefined || val === null || val === '') continue;
      const keyLower = key.toLowerCase();
      const reqLower = `${req.code} ${req.title}`.toLowerCase();

      if (
        (keyLower.includes('user') && reqLower.includes('пользовател')) ||
        (keyLower.includes('integration') && reqLower.includes('интеграц')) ||
        (keyLower.includes('screen') && reqLower.includes('экран')) ||
        (keyLower.includes('sec') && reqLower.includes('безопасн')) ||
        (keyLower.includes('fz') && reqLower.includes('фз')) ||
        (keyLower.includes('pac') && reqLower.includes('пак')) ||
        (keyLower.includes('hard') && reqLower.includes('оборудован'))
      ) {
        const fieldMeta = fieldKeyToField.get(key);
        sourceQuestion = {
          fieldKey: key,
          label: fieldMeta?.label || key,
          answerValue: String(val),
        };
        break;
      }
    }

    const descriptionText = getRequirementEffectiveText(req);
    const gostSection = resolveGostSection({ ...req, description: descriptionText });
    const pmiTest = resolvePmiTest({ ...req, description: descriptionText }, index);

    items.push({
      id: req.id,
      code: req.code,
      category,
      title: req.title,
      description: descriptionText,
      sourceQuestion,
      gostSection,
      pmiTest,
      stage: stage
        ? {
            id: stage.id,
            name: stage.name,
            role: stage.role,
            roleLabel: roleLabel(stage.role),
          }
        : undefined,
      mappingMethod: link ? link.method : 'UNMAPPED',
      status: isCovered ? 'covered' : 'unmapped',
    });

    index++;
  }

  const total = items.length;
  const covered = items.filter((i) => i.status === 'covered').length;
  const unmapped = total - covered;
  const coveragePercent = total > 0 ? Math.round((covered / total) * 100) : 100;

  return {
    items,
    metrics: {
      total,
      covered,
      unmapped,
      coveragePercent,
      byCategory,
    },
  };
}
