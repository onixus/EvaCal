import { Gost34InputPayload, Gost34Section } from '../types';

interface SoftwareSpecItem {
  name: string;
  vendor: string;
  reestrNumber: string;
  certification: string;
  licenseType: string;
  quantity: string;
}

interface HardwareSpecItem {
  name: string;
  model: string;
  reestrMinpromtorg: string;
  specs: string;
  formFactor: string;
  quantity: string;
}

export function buildSPEC34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const ctx = payload.projectContext;
  const citations = payload.standardProfile.citations;
  const answers = payload.answers || {};

  const platforms = ctx?.infrastructure?.platforms || [];
  const computeResources = ctx?.infrastructure?.computeResources;

  // 1. Построение каталога поставляемого ПО
  const softwareItems: SoftwareSpecItem[] = [];

  const textContext = `${platforms.join(' ')} ${JSON.stringify(answers)} ${meta.systemName}`.toLowerCase();

  if (/usergate|ngfw/i.test(textContext)) {
    const qty = answers.ngfw_clusters_count ? `${Number(answers.ngfw_clusters_count) * 2} шт.` : '2 шт. (HA-кластер)';
    softwareItems.push({
      name: 'UserGate NGFW (ПО межсетевого экранирования и обнаружения вторжений)',
      vendor: 'ООО «Юзергейт»',
      reestrNumber: '№ 1199',
      certification: 'Сертификат ФСТЭК России № 3905 (4 класс, профиль МЭ тип А, Б, СОВ)',
      licenseType: 'Бессрочная серверная сублицензия + подписка Security Updates 12 мес.',
      quantity: qty,
    });
  }

  if (/kaspersky|касперск/i.test(textContext)) {
    const endpoints = answers.endpoints_count ? `${answers.endpoints_count} лиц.` : '100 лиц.';
    softwareItems.push({
      name: 'Kaspersky Endpoint Security для бизнеса (Расширенный)',
      vendor: 'АО «Лаборатория Касперского»',
      reestrNumber: '№ 110',
      certification: 'Сертификат ФСТЭК России № 4238 (4 класс, 4 уровень доверия)',
      licenseType: 'Срочная сублицензия на 12/36 месяцев',
      quantity: endpoints,
    });
  }

  if (/cyberpeak|сайберпик|аудит.*данных/i.test(textContext)) {
    softwareItems.push({
      name: 'Cyberpeak (Система аудита доступа к неструктурированным данным)',
      vendor: 'ООО «Сайберпик»',
      reestrNumber: '№ 12590',
      certification: 'Свидетельство Роспатента № 2021665421',
      licenseType: 'Корпоративная сублицензия на защищаемые файловые хранилища',
      quantity: answers.storage_audits_count ? `${answers.storage_audits_count} серв.` : '2 серв.',
    });
  }

  if (/vipnet|випнет/i.test(textContext)) {
    softwareItems.push({
      name: 'ПО программного комплекса ViPNet Coordinator / Client',
      vendor: 'АО «ИнфоТеКС»',
      reestrNumber: '№ 5877',
      certification: 'Сертификаты ФСБ России СФ/124-4010 (КС1/КС2/КС3), ФСТЭК № 4118',
      licenseType: 'Бессрочная сублицензия со знаком соответствия ФСБ/ФСТЭК',
      quantity: answers.vpn_tunnels_count ? `${answers.vpn_tunnels_count} шт.` : '2 шт.',
    });
  }

  if (/astra|астра/i.test(textContext) || platforms.some((p) => /astra/i.test(p))) {
    softwareItems.push({
      name: 'Операционная система специального назначения «Astra Linux Special Edition»',
      vendor: 'ООО «РусБИТех-Астра»',
      reestrNumber: '№ 369',
      certification: 'Сертификат ФСТЭК России № 2553 (1 уровень доверия, макс. уровень «Смоленск»)',
      licenseType: 'Серверная лицензия с пакетом обновлений «Стандартный» / «Расширенный»',
      quantity: answers.servers_count ? `${answers.servers_count} серв.` : '4 серв.',
    });
  }

  if (/postgres|постгрес/i.test(textContext) || platforms.some((p) => /postgres/i.test(p))) {
    softwareItems.push({
      name: 'СУБД «Postgres Pro Enterprise»',
      vendor: 'ООО «Платфома» (Postgres Professional)',
      reestrNumber: '№ 104',
      certification: 'Сертификат ФСТЭК России № 3637 (4 класс, 4 уровень доверия)',
      licenseType: 'Бессрочная лицензия на серверное ядро (per-Core / per-Socket)',
      quantity: answers.db_clusters_count ? `${Number(answers.db_clusters_count) * 2} узла` : '2 узла',
    });
  }

  if (/secret net|dallas lock|соболь|нсд/i.test(textContext)) {
    softwareItems.push({
      name: 'СЗИ от НСД Secret Net LSP / Dallas Lock 8.0-C',
      vendor: 'ООО «Код Безопасности» / ООО «Конфидент»',
      reestrNumber: '№ 2841',
      certification: 'Сертификат ФСТЭК России № 3824 (2 уровень доверия, 4 класс)',
      licenseType: 'Клиентские и серверные лицензии с контролем целостности',
      quantity: 'По числу хостов',
    });
  }

  // Если специфических продуктов не найдено, добавляем общесистемные записи из контекста
  if (softwareItems.length === 0) {
    if (platforms.length > 0) {
      platforms.forEach((p) => {
        softwareItems.push({
          name: p,
          vendor: 'Отечественный правообладатель (Единый реестр ПО)',
          reestrNumber: 'В соответствии с 188-ФЗ',
          certification: 'Сертификат соответствия ФСТЭК/ФСБ (при наличии)',
          licenseType: 'Право использования (сублицензия)',
          quantity: '1 компл.',
        });
      });
    } else {
      softwareItems.push({
        name: `Прикладное и системное ПО подсистем «${meta.systemName}»`,
        vendor: 'Разработчик / Правообладатель',
        reestrNumber: 'Единый реестр российских программ (188-ФЗ)',
        certification: 'ГОСТ Р 56939 / Сертификат ФСТЭК',
        licenseType: 'Сублицензионный договор',
        quantity: '1 компл.',
      });
    }
  }

  // 2. Построение каталога поставляемого оборудования и ПАК
  const hardwareItems: HardwareSpecItem[] = [];

  const serversQty = answers.servers_count ? `${answers.servers_count} шт.` : '2 шт.';
  const racksQty = answers.racks_count ? `${answers.racks_count} шт.` : '1 шт.';

  if (/yadro|ядро/i.test(textContext) || answers.servers_count || computeResources) {
    const customSpecs = computeResources
      ? `${computeResources}, 2x Intel Xeon / AMD, Hardware RAID, 4x 10/25GbE SFP28, Redundant PSU, IPMI/BMC`
      : '2x Intel Xeon Scalable / AMD EPYC, 256 GB DDR4/DDR5 ECC, 2x 960 GB NVMe Boot, Hardware RAID, 4x 10/25GbE SFP28, 2x 1200W Redundant PSU, модуль удаленного управления IPMI/BMC';

    hardwareItems.push({
      name: 'Серверная платформа корпоративного класса YADRO Vegman / Аквариус',
      model: 'YADRO Vegman R220 G2 (Rack 2U)',
      reestrMinpromtorg: 'Реестр Минпромторга РФ (ПП РФ № 878 / № 719)',
      specs: customSpecs,
      formFactor: '2U Rackmount',
      quantity: serversQty,
    });
  }

  if (/схд|storage|диск/i.test(textContext) || answers.db_clusters_count || ctx?.infrastructure?.storage) {
    const storageSpecs = ctx?.infrastructure?.storage
      ? `${ctx.infrastructure.storage}, All-Flash NVMe, двухконтроллерная архитектура (Active-Active), FC 16/32G / iSCSI 25GbE`
      : 'Двухконтроллерная архитектура (Active-Active), кэш-память 128 GB, полезная емкость от 20 TB NVMe TLC, 8x 16/32Gb FC / 25GbE iSCSI, снапшоты, репликация';

    hardwareItems.push({
      name: 'Система хранения данных (СХД All-Flash NVMe)',
      model: 'YADRO TATLIN.UNIFIED / Скала^р СХД',
      reestrMinpromtorg: 'Реестр Минпромторга РФ (ПП РФ № 878)',
      specs: storageSpecs,
      formFactor: '2U/4U Rackmount',
      quantity: '1 компл.',
    });
  }

  if (/usergate|ngfw/i.test(textContext)) {
    hardwareItems.push({
      name: 'Аппаратная платформа межсетевого экрана UserGate Hardware Appliance',
      model: 'UserGate C150 / D200 / F8000',
      reestrMinpromtorg: 'Реестр Минпромторга РФ',
      specs: 'Отказоустойчивая пара HA (Active-Passive), пропускная способность NGFW от 10 Гбит/с, bypass-порты, резервированные блоки питания',
      formFactor: '1U Rackmount',
      quantity: answers.ngfw_clusters_count ? `${Number(answers.ngfw_clusters_count) * 2} шт.` : '2 шт.',
    });
  }

  if (hardwareItems.length === 0) {
    hardwareItems.push({
      name: 'Серверные платформы вычислительного контура',
      model: 'Отечественная серверная платформа (РФ)',
      reestrMinpromtorg: 'ПП РФ № 878 / № 719',
      specs: computeResources || 'Многоядерная конфигурация, от 128 GB RAM, RAID 10 SSD/NVMe, Redundant PSU',
      formFactor: 'Rack 1U/2U',
      quantity: '1 компл.',
    });
  }

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ВВОДНАЯ ЧАСТЬ И НАЗНАЧЕНИЕ СПЕЦИФИКАЦИИ',
      paragraphs: [
        `1.1 Настоящая спецификация оборудования и программного обеспечения составлена в соответствии с требованиями ${citations.specificationBasis} на систему «${meta.systemName}» (${meta.fullSystemName}).`,
        `1.2 Документ устанавливает полный перечень, технические характеристики, комплектность и правовые основания применения программных средств, серверного оборудования и программно-аппаратных комплексов (ПАК), поставляемых и внедряемых у Заказчика (${meta.customerName}) в рамках договора ${meta.contractNumber || 'на создание системы'}.`,
        '1.3 Все программные продукты и аппаратные платформы выбраны с соблюдением требований законодательства РФ о защите информации (152-ФЗ, 187-ФЗ) и приоритете отечественных решений из Единого реестра российских программ (188-ФЗ) и Реестра промышленной продукции Минпромторга РФ (ПП РФ № 878 / № 719).',
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'СПЕЦИФИКАЦИЯ ПРОГРАММНОГО ОБЕСПЕЧЕНИЯ И ЛИЦЕНЗИЙ (188-ФЗ)',
      paragraphs: [
        '2.1 Перечень поставляемого системного, прикладного программного обеспечения и средств защиты информации (СЗИ/СКЗИ) приведен в Таблице 1.',
        '2.2 Поставка лицензий осуществляется с передачей сублицензионных прав и формуляров, заверенных знаками соответствия ФСТЭК России / ФСБ России.',
      ],
      tables: [
        {
          caption: 'Таблица 1 — Ведомость программного обеспечения и лицензий',
          headers: [
            '№',
            'Наименование программного обеспечения',
            'Правообладатель / Вендор',
            '№ в Реестре Минцифры (188-ФЗ)',
            'Сертификат ФСТЭК / ФСБ',
            'Тип сублицензии',
            'Количество',
          ],
          rows: softwareItems.map((item, idx) => [
            idx + 1,
            item.name,
            item.vendor,
            item.reestrNumber,
            item.certification,
            item.licenseType,
            item.quantity,
          ]),
        },
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'СПЕЦИФИКАЦИЯ СЕРВЕРНОГО ОБОРУДОВАНИЯ, СХД И ПАК',
      paragraphs: [
        '3.1 Состав серверного оборудования, дисковых подсистем хранения данных и программно-аппаратных комплексов (ПАК) приведен в Таблице 2.',
        '3.2 Все поставляемое оборудование сопровождается официальной гарантией производителя сроком не менее 36 месяцев с возможностью оперативной замены компонентов (SLA Next Business Day / 4h).',
      ],
      tables: [
        {
          caption: 'Таблица 2 — Спецификация серверного оборудования и аппаратных платформ',
          headers: [
            '№',
            'Наименование позиции',
            'Модель / Платформа',
            'Реестр Минпромторга РФ',
            'Технические характеристики (CPU / RAM / Диски / Сеть)',
            'Форм-фактор',
            'Кол-во',
          ],
          rows: hardwareItems.map((item, idx) => [
            idx + 1,
            item.name,
            item.model,
            item.reestrMinpromtorg,
            item.specs,
            item.formFactor,
            item.quantity,
          ]),
        },
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'СПЕЦИФИКАЦИЯ ПАССИВНОГО ОБОРУДОВАНИЯ, СТОЕК 42U И СКС',
      paragraphs: [
        '4.1 Перечень шкафов, распределения электропитания и коммутационных компонентов приведен в Таблице 3.',
      ],
      tables: [
        {
          caption: 'Таблица 3 — Спецификация серверных стоек, электропитания и СКС',
          headers: ['№', 'Наименование элемента', 'Назначение и технические характеристики', 'Количество'],
          rows: [
            [
              1,
              'Телекоммуникационный шкаф 42U / 48U (600x1200 / 800x1200)',
              'Напольный серверный шкаф с перфорированными дверьми (вентиляция ≥ 80%), замками и датчиками открытия',
              racksQty,
            ],
            [
              2,
              'Блоки распределения питания (PDU) с АВР',
              'Управляемые PDU 32A с мониторингом по SNMP/IPMI, раздельные вводы электропитания (Ввод А + Ввод Б)',
              `${Number(answers.racks_count || 1) * 2} шт.`,
            ],
            [
              3,
              'Кабельная подсистема (СКС Cat.6A / Оптика OM4)',
              'Медные патч-корды RJ-45 Cat.6A, оптические патч-корды LC-LC Duplex, кабельные органайзеры 1U',
              '1 комплект',
            ],
            [
              4,
              'Комплект запасных частей, инструментов и принадлежностей (ЗИП)',
              'Резервные вентиляторы охлаждения, кабели питания, запасной блок питания PSU, крепежные наборы М6',
              '1 комплект',
            ],
          ],
        },
      ],
    },
    {
      id: 'sec-5',
      numStr: '5',
      title: 'КОМПЛЕКТНОСТЬ ПОСТАВКИ, ФОРМУЛЯРЫ И ЗНАКИ СООТВЕТСТВИЯ',
      paragraphs: [
        '5.1 Поставка программных и аппаратных средств осуществляется комплектно в заводской невскрытой упаковке производителя.',
        '5.2 В состав сопроводительной документации на каждую единицу СЗИ/СКЗИ и ПАК входят:',
        '— Паспорт и формуляр изделия с отметками отдела технического контроля (ОТК);',
        '— Голографические знаки соответствия ФСТЭК России / ФСБ России;',
        '— Копия действующего сертификата соответствия, заверенная печатью правообладателя;',
        '— Лицензионный сертификат с уникальным серийным номером и кодом активации;',
        '— Эталонные дистрибутивы на защищенных носителях с расчетом контрольных сумм по алгоритму ГОСТ Р 34.11-2012 / SHA-256;',
        '— Комплект эксплуатационной документации по ГОСТ 34.201-2020 / РД 50-34.698-90.',
      ],
    },
  ];
}
