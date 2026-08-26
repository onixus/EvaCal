import { Gost34InputPayload, Gost34Section } from '../types';
import {
  VENDOR_HARDWARE,
  buildVendorMatchText,
  findVendorHardware,
  findVendorSoftware,
  quantityFromRule,
  registryLine,
  requisiteNeedsReview,
} from '../vendors';

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

  const matchText = buildVendorMatchText(platforms, answers, meta.systemName);

  // 1. Каталог поставляемого ПО — из базы знаний вендоров РФ
  const softwareItems: SoftwareSpecItem[] = findVendorSoftware(matchText).map((p) => ({
    name: p.name,
    vendor: p.vendor,
    reestrNumber: registryLine(p),
    certification:
      (p.certification || 'Единый реестр российского ПО (188-ФЗ)') +
      (requisiteNeedsReview(p) ? ' [реквизит подлежит повторной сверке]' : ''),
    licenseType: p.licenseType,
    quantity: quantityFromRule(p.quantity, answers),
  }));

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

  // 2. Каталог поставляемого оборудования и ПАК
  const hardwareItems: HardwareSpecItem[] = [];
  const matchedHardware = findVendorHardware(matchText);
  const includedHardwareIds = new Set(matchedHardware.map((h) => h.id));

  // Серверная платформа нужна и без явного упоминания вендора — по ресурсам расчёта.
  if (
    !matchedHardware.some((h) => h.category === 'server') &&
    (answers.servers_count || computeResources)
  ) {
    const server = VENDOR_HARDWARE.find((h) => h.id === 'yadro-vegman')!;
    matchedHardware.unshift(server);
    includedHardwareIds.add(server.id);
  }
  // СХД — при наличии кластеров СУБД или заданной подсистемы хранения.
  if (
    !matchedHardware.some((h) => h.category === 'storage') &&
    (answers.db_clusters_count || ctx?.infrastructure?.storage)
  ) {
    const storage = VENDOR_HARDWARE.find((h) => h.id === 'yadro-tatlin')!;
    matchedHardware.push(storage);
    includedHardwareIds.add(storage.id);
  }

  for (const hw of matchedHardware) {
    let specs = hw.defaultSpecs;
    if (hw.category === 'server' && computeResources) {
      specs = `${computeResources}, 2x Intel Xeon / AMD, Hardware RAID, 4x 10/25GbE SFP28, Redundant PSU, IPMI/BMC`;
    }
    if (hw.category === 'storage' && ctx?.infrastructure?.storage) {
      specs = `${ctx.infrastructure.storage}, All-Flash NVMe, двухконтроллерная архитектура (Active-Active), FC 16/32G / iSCSI 25GbE`;
    }
    hardwareItems.push({
      name: hw.name,
      model: hw.model,
      reestrMinpromtorg: hw.reestrMinpromtorg,
      specs,
      formFactor: hw.formFactor,
      quantity: quantityFromRule(hw.quantity, answers),
    });
  }

  if (hardwareItems.length === 0) {
    hardwareItems.push({
      name: 'Серверные платформы вычислительного контура',
      model: 'Отечественная серверная платформа (РФ)',
      reestrMinpromtorg: 'ПП РФ № 878 / № 719',
      specs:
        computeResources ||
        'Многоядерная конфигурация, от 128 GB RAM, RAID 10 SSD/NVMe, Redundant PSU',
      formFactor: 'Rack 1U/2U',
      quantity: '1 компл.',
    });
  }

  const racksQty = answers.racks_count ? `${answers.racks_count} шт.` : '1 шт.';

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ВВОДНАЯ ЧАСТЬ И НАЗНАЧЕНИЕ СПЕЦИФИКАЦИИ',
      paragraphs: [
        `1.1 Настоящая спецификация оборудования и программного обеспечения составлена в соответствии с требованиями ${citations.specificationBasis} на систему «${meta.systemName}» (${meta.fullSystemName}).`,
        `1.2 Документ устанавливает полный перечень, технические характеристики, комплектность и правовые основания применения программных средств, серверного оборудования и программно-аппаратных комплексов (ПАК), поставляемых и внедряемых у Заказчика (${meta.customerName}) в рамках договора ${meta.contractNumber || 'на создание системы'}.`,
        '1.3 Все программные продукты и аппаратные платформы выбраны с соблюдением требований законодательства РФ о защите информации (152-ФЗ, 187-ФЗ) и приоритете отечественных решений из Единого реестра российских программ (188-ФЗ) и Реестра промышленной продукции Минпромторга РФ (ПП РФ № 878 / № 719).',
        '1.4 Номера записей реестров и сертификатов соответствия приведены по состоянию на дату выпуска документа; перед заключением договора поставки они подлежат контрольной сверке с актуальными данными реестров Минцифры России, Минпромторга России и государственных реестров ФСТЭК/ФСБ России.',
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
          headers: [
            '№',
            'Наименование элемента',
            'Назначение и технические характеристики',
            'Количество',
          ],
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
