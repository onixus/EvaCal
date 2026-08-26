import { Gost34RequirementItem, Gost34EnrichmentOptions } from './types';
import type { ProjectContext } from './context/types';
import { evaluateApplicability, toEnrichmentOptions, type OverrideInput } from './applicability';

/**
 * Returns standard GOST 34 / RF regulatory requirements based on selected options or ProjectContext evaluation:
 * - FSTEK Order No. 21 (ISPDn)
 * - FSTEK Order No. 117 (GIS protection, supersedes No. 17 from 01.03.2026) + GOST R 56939-2024 (Secure Development)
 * - FSTEK Order No. 239 (KII Security)
 * - GOST R 57580.1-2017 / STO BR IBBS
 * - CBR Regulation No. 683-P (Bank Software Security & API Integrity)
 * - CBR Regulation No. 757-P (NFO Security)
 * - CBR Regulation No. 719-P (Anti-fraud Logging & Electronic Signatures)
 * - FSB Order No. 282 (GosSOPKA / NKCKI)
 * - Federal Law No. 187-FZ (Critical Information Infrastructure)
 * - Federal Law No. 152-FZ / 242-FZ (Personal Data Localization in RF)
 * - Federal Law No. 188-FZ (Russian Software Registry, Astra Linux/PostgreSQL)
 * - SLA 99.9% Reliability (RTO ≤ 15 min, RPO ≤ 5 min)
 * - GOST Р 52872-2019 / WCAG 2.1 AA (Web Accessibility)
 */
/** Every enrichment flag, in UI order. Single source of truth for the option count. */
export const ENRICHMENT_OPTION_KEYS: Array<keyof Gost34EnrichmentOptions> = [
  'fstek_21',
  'fstek_117',
  'fstek_239',
  'gost_57580',
  'cb_683p',
  'cb_757p',
  'cb_719p',
  'fsb_282_gossopka',
  'fz_187_kii',
  'fz_152',
  'fz_188_reestr',
  'sla_999',
  'wcag_52872',
];

interface EnrichmentRule {
  key: keyof Gost34EnrichmentOptions;
  code: string;
  category: 'security' | 'technical' | 'reliability' | 'ergonomics';
  title: string;
  description: string;
}

const ENRICHMENT_RULES: EnrichmentRule[] = [
  {
    key: 'fstek_21',
    code: 'ТР-БЕЗ-21',
    category: 'security',
    title: 'Соблюдение требований Приказа ФСТЭК России № 21 (Защита ИСПДн)',
    description:
      'Система должна обеспечивать комплексную защиту персональных данных в соответствии с требованиями Приказа ФСТЭК России № 21 от 18.02.2013 г. для уровней защищенности ИСПДн (УЗ-3 / УЗ-2 / УЗ-1). Включает управление доступом, регистрацию событий безопасности, антивирусную защиту и контроль целостности.',
  },
  {
    key: 'fstek_117',
    code: 'ТР-БЕЗ-117',
    category: 'security',
    title:
      'Защита информации в ГИС по Приказу ФСТЭК № 117 и безопасная разработка по ГОСТ Р 56939-2024',
    description:
      'Система должна соответствовать Требованиям о защите информации, утверждённым Приказом ФСТЭК России № 117 от 11.04.2025 г. (вступает в силу 01.03.2026, заменяет Приказ № 17 от 11.02.2013 г.), включая целевые показатели защищённости и сроки устранения уязвимостей. Разработка прикладного ПО ведётся с соблюдением ГОСТ Р 56939-2024 «Защита информации. Разработка безопасного программного обеспечения»: статический анализ (SAST), динамический анализ (DAST), контроль сторонних компонентов (SCA) и отсутствия недекларированных возможностей (НДВ); требования безопасной разработки включаются в ТЗ подрядчика.',
  },
  {
    key: 'fstek_239',
    code: 'ТР-БЕЗ-239',
    category: 'security',
    title: 'Безопасность объектов КИИ по Приказу ФСТЭК России № 239',
    description:
      'Система должна выполнять требования Приказа ФСТЭК России № 239 от 25.12.2017 г. по обеспечению безопасности значимых объектов критической информационной инфраструктуры Российской Федерации для 1, 2 и 3 категорий значимости.',
  },
  {
    key: 'gost_57580',
    code: 'ТР-БЕЗ-57580',
    category: 'security',
    title: 'Требования ГОСТ Р 57580.1-2017 и СТО БР ИББС (Финансовые операции)',
    description:
      'Система должна соответствовать требованиями ГОСТ Р 57580.1-2017 «Безопасность финансовых (банковских) операций. Защита информации финансовых организаций. Базовый состав организационных и технических мер» для целевых уровней защиты информации (минимальный / стандартный / усиленный).',
  },
  {
    key: 'cb_683p',
    code: 'ТР-БЕЗ-683П',
    category: 'security',
    title: 'Соблюдение Положения Банка России № 683-П (Кредитные организации)',
    description:
      'Прикладное ПО системы должно отвечать требованиями Положения Банка России № 683-П от 17.04.2019 г., обеспечивая целостность программных кодов, защищенный обмен по API, аутентификацию сетевых запросов и сертифицированную защиту от вирусных угроз.',
  },
  {
    key: 'cb_757p',
    code: 'ТР-БЕЗ-757П',
    category: 'security',
    title: 'Соблюдение Положения Банка России № 757-П (Некредитные финансовые организации)',
    description:
      'Система должна удовлетворять требованиям Положения Банка России № 757-П от 20.04.2021 г. по обеспечению защиты информации НФО при осуществлении деятельности в сфере финансовых рынков.',
  },
  {
    key: 'cb_719p',
    code: 'ТР-БЕЗ-719П',
    category: 'security',
    title: 'Антифрод-журналирование и СКЗИ по Положению ЦБ РФ № 719-П',
    description:
      'В системе должно быть реализовано двухуровневое антифрод-журналирование электронных сообщений и финансовых транзакций с возможностью применения средств криптографической защиты информации (СКЗИ/HSM) по ГОСТ Р 34.12-2015 и электронной подписи (УЭП/УКЭП) согласно Положению ЦБ № 719-П.',
  },
  {
    key: 'fsb_282_gossopka',
    code: 'ТР-БЕЗ-282',
    category: 'security',
    title: 'Передача данных в ГосСОПКА по Приказу ФСБ России № 282',
    description:
      'Система должна обеспечивать автоматическое выявление инцидентов ИБ и их передачу в Национальный координационный центр по компьютерным инцидентам (НКЦКИ / ГосСОПКА) в соответствии с Приказами ФСБ России № 282 и № 196.',
  },
  {
    key: 'fz_187_kii',
    code: 'ТР-БЕЗ-187ФЗ',
    category: 'security',
    title: 'Соблюдение требования Федерального закона № 187-ФЗ «О безопасности КИИ РФ»',
    description:
      'Функционирование системы должно соответствовать требованиям Федерального закона № 187-ФЗ от 26.07.2017 г. «О безопасности критической информационной инфраструктуры Российской Федерации» в части категориования, аудита и непрерывного мониторинга безопасности.',
  },
  {
    key: 'fz_152',
    code: 'ТР-БЕЗ-152ФЗ',
    category: 'security',
    title: 'Локализация баз данных персональных данных на территории РФ (152-ФЗ / 242-ФЗ)',
    description:
      'Базы данных системы, содержащие персональные данные граждан Российской Федерации, должны физически размещаться и обрабатываться исключительно на серверах ЦОД, расположенных на территории Российской Федерации (152-ФЗ / 242-ФЗ).',
  },
  {
    key: 'fz_188_reestr',
    code: 'ТР-ТЕХ-188ФЗ',
    category: 'technical',
    title: 'Совместимость с Единым реестром российского ПО (188-ФЗ)',
    description:
      'Компоненты системы должны гарантированно функционировать на базе отечественного системного ПО (ОС Astra Linux / Alt Linux, СУБД PostgreSQL / Postgres Pro) для соответствия критериям Единого реестра российских программ по 188-ФЗ.',
  },
  {
    key: 'sla_999',
    code: 'ТР-НАД-SLA',
    category: 'reliability',
    title: 'Непрерывность функционирования и целевые показатели RTO/RPO (SLA 99.9%)',
    description:
      'Система должна обеспечивать коэффициент доступности не менее 99.9% (режим работы 24/7/365). Время восстановления после аварий (RTO) — не более 15 минут, допустимая глубина потери данных (RPO) — не более 5 минут. Должна быть настроена потоковая репликация WAL.',
  },
  {
    key: 'wcag_52872',
    code: 'ТР-ЭРГ-WCAG',
    category: 'ergonomics',
    title: 'Доступность интерфейсов по ГОСТ Р 52872-2019 и WCAG 2.1 AA',
    description:
      'Пользовательский веб-интерфейс системы должен соответствовать требованиям ГОСТ Р 52872-2019 «Интернет-ресурсы и требования доступности для людей с инвалидностью» и стандарту WCAG 2.1 AA. Время отклика интерфейса на операции не должно превышать 1.5 секунд.',
  },
];

export function getEnrichedGostRequirements(
  options?: Gost34EnrichmentOptions,
  context?: ProjectContext,
  overrides?: OverrideInput,
): Gost34RequirementItem[] {
  let opts: Gost34EnrichmentOptions;

  if (context) {
    const applicability = evaluateApplicability(context, overrides ?? options);
    opts = toEnrichmentOptions(applicability);
  } else if (options) {
    opts = options;
  } else {
    opts = {};
  }

  const reqs: Gost34RequirementItem[] = [];
  let idx = 1;

  for (const rule of ENRICHMENT_RULES) {
    if (opts[rule.key] === true) {
      reqs.push({
        id: `req-norm-${idx++}`,
        code: rule.code,
        category: rule.category,
        title: rule.title,
        description: rule.description,
      });
    }
  }

  return reqs;
}
