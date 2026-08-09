import { Gost34InputPayload, Gost34Section } from '../types';

export function buildSPEC34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const ctx = payload.projectContext;
  const citations = payload.standardProfile.citations;

  const platforms = ctx?.infrastructure?.platforms || ['Серверная ОС Linux', 'Реляционная СУБД', 'Сервер приложений'];
  const computeResources = ctx?.infrastructure?.computeResources || 'Не менее 4 vCPU, 8 ГБ RAM';
  const storage = ctx?.infrastructure?.storage || 'Не менее 100 ГБ Storage';
  const network = ctx?.infrastructure?.network || '1000 Mbps Ethernet';

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ВВОДНАЯ ЧАСТЬ И НАЗНАЧЕНИЕ СПЕЦИФИКАЦИИ',
      paragraphs: [
        `1.1 Настоящая спецификация составлена в соответствии с ${citations.specificationBasis} на систему «${meta.systemName}».`,
        `1.2 Документ содержит полный перечень программных средств, серверного оборудования, вычислительной техники и сетевых средств, необходимых для развертывания и эксплуатации системы у Заказчика (${meta.customerName}).`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'СПЕЦИФИКАЦИЯ ПРОГРАММНЫХ СРЕДСТВ И СИСТЕМНОГО ПО',
      paragraphs: ['2.1 Состав системного и прикладного программного обеспечения представлен в Таблице 1.'],
      tables: [
        {
          caption: 'Таблица 1 — Спецификация программных средств и компонент',
          headers: ['№', 'Наименование ПО / Компонента', 'Назначение / Тип лицензии', 'Количество'],
          rows: [
            ...platforms.map((p, idx) => [idx + 1, p, 'Общесистемное ПО / Прикладной компонент', '1 инст.']),
            [platforms.length + 1, `Прикладное ПО системы «${meta.systemName}»`, 'Собственная / Лицензия Заказчика', '1 лиц.'],
          ],
        },
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'СПЕЦИФИКАЦИЯ СЕРВЕРНОГО ОБОРУДОВАНИЯ И СЕТЕВОЙ ИНФРАСТРУКТУРЫ',
      paragraphs: ['3.1 Требования к серверному оборудованию целевого вычислительного контура приведены в Таблице 2.'],
      tables: [
        {
          caption: 'Таблица 2 — Спецификация серверных вычислительных ресурсов',
          headers: ['№', 'Наименование элемента', 'Минимальные технические характеристики', 'Количество'],
          rows: [
            [1, 'Вычислительные ресурсы (CPU / RAM)', computeResources, '1 комплект'],
            [2, 'Дисковая подсистема (Storage)', storage, '1 комплект'],
            [3, 'Сетевой интерфейс (NIC / Network)', network, '1 комплект'],
          ],
        },
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ТРЕБОВАНИЯ К РАБОЧИМ МЕСТАМ ПОЛЬЗОВАТЕЛЕЙ И АДМИНИСТРАТОРОВ',
      paragraphs: ['4.1 Спецификация клиентских рабочих мест пользователей представлена в Таблице 3.'],
      tables: [
        {
          caption: 'Таблица 3 — Спецификация рабочих мест (АРМ)',
          headers: ['№', 'Тип АРМ', 'Минимальная конфигурация ПК', 'Программное окружение'],
          rows: [
            [1, 'АРМ Пользователя', 'Стандартный ПК / Дисплей Full HD', 'Современный веб-браузер'],
            [2, 'АРМ Администратора', 'Производительный ПК / Дисплей Full HD', 'Веб-браузер, SSH-клиент'],
          ],
        },
      ],
    },
  ];
}
