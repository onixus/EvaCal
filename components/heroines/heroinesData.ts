export interface Heroine {
  id: string;
  name: string;
  title: string;
  subtitle: string;
  role: string;
  themeColor: string;
  glowColor: string;
  avatarBg: string;
  badge: string;
  avatarIcon: string;
  description: string;
  image: string;
  fullImage: string;
  quotes: string[];
  stats: {
    mana: string;
    power: string;
    affinity: string;
  };
}

export const HEROINES: Heroine[] = [
  {
    id: 'morgana',
    name: 'Моргана',
    title: 'Архимаг Системной Архитектуры',
    subtitle: 'Хранительница Технических Заданий и Бархатного Кодекса',
    role: 'Архитектура & ТЗ',
    themeColor: '#e879f9',
    glowColor: 'rgba(232, 121, 249, 0.45)',
    avatarBg: 'from-fuchsia-950/80 via-purple-950/70 to-black',
    badge: '🔮 Бездна Знаний',
    avatarIcon: '🔮',
    image: '/images/morgana_avatar.png',
    fullImage: '/images/morgana.png',
    description:
      'Верховная чародейка тёмного кодекса в бархатном корсете и с аметистовым чокером. Её взор пронзает сложные интеграции и микросервисы.',
    quotes: [
      '«Магические контуры архитектуры сплетены безупречно... Ни один модуль не скроется от Бездны.»',
      '«В техническом задании заключена древняя сила. Проверь матрицу требований, путник.»',
      '«Каждая строчка кода — это заклинание. Пусть оно будет чистым и непоколебимым.»',
      '«Я чувствую приближение сложной интеграции. Будь наготове.»',
    ],
    stats: {
      mana: '9,850 MP',
      power: '99.8% Архитектура',
      affinity: 'Тёмная Магия ТЗ',
    },
  },
  {
    id: 'eir',
    name: 'Валькирия Эйр',
    title: 'Дева Битвы и Калькуляций',
    subtitle: 'Повелительница Человеко-часов в Тёмных Доспехах',
    role: 'Калькуляция & Трудозатраты',
    themeColor: '#c084fc',
    glowColor: 'rgba(192, 132, 252, 0.45)',
    avatarBg: 'from-purple-950/90 via-slate-950 to-black',
    badge: '⚔️ Тёмная Воительница',
    avatarIcon: '⚔️',
    image: '/images/eir_avatar.png',
    fullImage: '/images/eir.png',
    description:
      'Дева битвы с фиолетовыми локонами в резном чешуйчатом панцире. Её холодный расчет защищает бюджет и дедлайны проекта.',
    quotes: [
      '«Трудозатраты измерены сталью и временем. Не позволяй дедлайнам пасть в бездну!»',
      '«РП-надбавка готова отразить любые рисковые атаки заказчика.»',
      '«График Ганта выкован без единой бреши. В бой за успешный релиз!»',
      '«Твоя оценка в часах остра, как мой клинок. Держи этот темп!»',
    ],
    stats: {
      mana: '8,400 MP',
      power: '100% Защита Сроков',
      affinity: 'Тёмная Чешуя Ганта',
    },
  },
  {
    id: 'selene',
    name: 'Селена',
    title: 'Лунная Дева Нормативов ГОСТ',
    subtitle: 'Оракул ГОСТ 34.602 в Бирюзовом Шёлке',
    role: 'Нормативы & Документы',
    themeColor: '#38bdf8',
    glowColor: 'rgba(56, 189, 248, 0.45)',
    avatarBg: 'from-cyan-950/80 via-slate-950 to-black',
    badge: '🌙 Лунный Оракул',
    avatarIcon: '🌙',
    image: '/images/selene_avatar.png',
    fullImage: '/images/selene.png',
    description:
      'Лунная жрица в струящемся бирюзовом платье с кулоном-полумесяцем. Её священный лунный свет освящает документацию по ГОСТ.',
    quotes: [
      '«Штампы ГОСТ 2.104 и параграфы РД 50-34 благословлены лунным светом.»',
      '«Рамка формы 2 хранит священные подписи: Разработал, Проверил, Утвердил.»',
      '«Все 13 нормативных барьеров РФ пройдут испытания без единого изъяна.»',
      '«Чистота документации рождает величие проекта. Печать ГОСТ наложена.»',
    ],
    stats: {
      mana: '9,200 MP',
      power: 'ГОСТ 34.602 / Форма 2',
      affinity: 'Лунный Шёлк & Закон',
    },
  },
  {
    id: 'lilith',
    name: 'Лилит',
    title: 'Чародейка Пресейла & Соблазна',
    subtitle: 'Магистр Вероятностей в Черном Кружеве',
    role: 'Пресейл & Опросники',
    themeColor: '#f43f5e',
    glowColor: 'rgba(244, 63, 94, 0.45)',
    avatarBg: 'from-rose-950/90 via-black to-red-950/80',
    badge: '🩸 Багровая Судьба',
    avatarIcon: '🩸',
    image: '/images/lilith_avatar.png',
    fullImage: '/images/lilith.png',
    description:
      'Обольстительница вероятностей с ониксовыми рожками в соблазнительном черном кружеве с рубиновым сердцем. Убеждает любого заказчика подписать контракт.',
    quotes: [
      '«Любой каприз заказчика обратится в прибыльный контракт... если правильно зачаровать опросник.»',
      '«Скидка 15%? Только если они согласятся на аванс в 70%, сладкий.»',
      '«Твоя пресейл-презентация бьёт прямо в цель. Мы забираем этот тендер!»',
      '«Никто не сможет устоять перед нашим коммерческим предложением.»',
    ],
    stats: {
      mana: '9,990 MP',
      power: '98.5% Конверсия Пресейла',
      affinity: 'Багровый Соблазн Контракта',
    },
  },
];

export function getHeroineLoreAdvice(
  heroineId: string,
  pathname: string,
): { title: string; text: string } {
  const isStudio = pathname.includes('/studio');
  const isCalc = pathname.includes('/calculations/') && !isStudio;
  const isPresale = pathname.includes('/presale');
  const isReview = pathname.includes('/review');
  const isAgents = pathname.includes('/agents');

  switch (heroineId) {
    case 'morgana':
      if (isStudio) {
        return {
          title: 'Око Архимага на страже ТЗ',
          text: 'В Студии ГОСТ 34 сплетаются контуры разделов 4 и 6. Помни: требования к системе должны быть неизмеримо чисты, а интеграторские этапы — лежать в разделе работ.',
        };
      }
      if (isAgents) {
        return {
          title: 'Астральный резонанс харнесса',
          text: 'Внешние агенты — словно фамильяры. Проверь отклик через пинг, чтобы ни один сбой сети не нарушил консилиум ревью.',
        };
      }
      if (isCalc) {
        return {
          title: 'Архитектурный надзор сметы',
          text: 'Каждый трудовой этап здесь питает матрицу трассируемости. Следи за связностью ролей архитектора и ведущих разработчиков.',
        };
      }
      return {
        title: 'Взор Бездны',
        text: 'Архитектура системы стабильна. Магические потоки данных и технические задания под моим непрерывным надзором.',
      };

    case 'eir':
      if (isCalc) {
        return {
          title: 'Боевой строй трудозатрат',
          text: 'Часы измерены сталью! Не забывай про рисковую надбавку — она прикроет бюджет от внезапных атак заказчика.',
        };
      }
      if (isStudio) {
        return {
          title: 'План битвы по ГОСТ',
          text: 'Раздел 6 — это наш боевой график. Проверь даты вех и трудоёмкость пусконаладки, дедлайны не ждут!',
        };
      }
      if (isAgents) {
        return {
          title: 'Харнесс-дозор наготове',
          text: 'Боевые агенты готовы к штурму комплектов. Отправь пинг и убедись, что строй не дрогнет под нагрузкой.',
        };
      }
      return {
        title: 'Щит Валькирии',
        text: 'Все сметы проверены, сроки защищены. Ни один человеко-час не будет потрачен впустую!',
      };

    case 'selene':
      if (isStudio || isReview) {
        return {
          title: 'Лунный Оракул нормативов',
          text: 'Печать ГОСТ 34.602 и штампы ГОСТ 2.104 освящены лунным светом. Следи за измеримостью формулировок и подписями нормоконтроля.',
        };
      }
      if (isAgents) {
        return {
          title: 'Аудит внешних оракулов',
          text: 'Харнесс-агенты помогают выявить скрытые пороки в тексте ТЗ. Проверь их готовность к валидации.',
        };
      }
      return {
        title: 'Благословение ГОСТ',
        text: 'Каноны стандартов РФ соблюдены. Проект движется по истинному пути нормативной безупречности.',
      };

    case 'lilith':
    default:
      if (isPresale) {
        return {
          title: 'Чары прибыльного опросника',
          text: 'Задай правильные вопросы в опроснике, милый! Чем глубже детализация, тем выше маржа и надежнее контракт.',
        };
      }
      if (isCalc) {
        return {
          title: 'Соблазн маржинальности',
          text: 'Маржа выглядит великолепно! Не давай заказчику сбивать ставку без встречных уступок по предоплате.',
        };
      }
      if (isAgents) {
        return {
          title: 'Тайные шпионы пресейла',
          text: 'Подключенные агенты найдут все уязвимости до того, как их заметит клиент. Держи их на коротком поводке!',
        };
      }
      return {
        title: 'Багровая удача',
        text: 'Вероятности на нашей стороне. Коммерческое предложение поразит заказчика в самое сердце!',
      };
  }
}

export function getHeroineHarnessPingLore(
  heroineId: string,
  agentName: string,
  success: boolean,
  errorMsg?: string,
): string {
  if (success) {
    switch (heroineId) {
      case 'morgana':
        return `«Астральный канал с агентом «${agentName}» кристально чист. Эхо-сигнал 200 OK вернулся без помех.»`;
      case 'eir':
        return `«Агент «${agentName}» подтвердил боеготовность! Связь устойчива, дозор на позиции.»`;
      case 'selene':
        return `«Лунный луч коснулся агента «${agentName}». Ответ получен, шлюз готов к проверке нормативов.»`;
      case 'lilith':
      default:
        return `«Агент «${agentName}» послушно отозвался на мой зов. Канал связи налажен безупречно, милый.»`;
    }
  } else {
    const err = errorMsg ? ` (${errorMsg})` : '';
    switch (heroineId) {
      case 'morgana':
        return `«Астральный разрыв! Агент «${agentName}» не отвечает${err}. Проверь endpoint и сетевые барьеры.»`;
      case 'eir':
        return `«Агент «${agentName}» потерял строй${err}! Сигнал заглушен, требуется перезапуск контура.»`;
      case 'selene':
        return `«Тьма скрыла агента «${agentName}»${err}. Запрос отвергнут, проверь конфигурацию шлюза.»`;
      case 'lilith':
      default:
        return `«Упс... Агент «${agentName}» капризничает и не отвечает${err}. Загляни в настройки, сладкий.»`;
    }
  }
}

export function getHeroineHarnessReviewLore(
  heroineId: string,
  agentName: string,
  findingsCount: number,
): string {
  if (findingsCount === 0) {
    switch (heroineId) {
      case 'morgana':
        return `«Агент «${agentName}» завершил ревью: чистота архитектуры абсолютна, замечаний нет!»`;
      case 'eir':
        return `«Агент «${agentName}» провел инспекцию: строй без единой бреши, 0 замечаний!»`;
      case 'selene':
        return `«Агент «${agentName}» одобрил комплект: полное соответствие канонам, 0 замечаний!»`;
      case 'lilith':
      default:
        return `«Агент «${agentName}» в восторге от комплекта: всё гладко, ни одной претензии!»`;
    }
  } else {
    switch (heroineId) {
      case 'morgana':
        return `«Агент «${agentName}» извлёк ${findingsCount} находок. Ознакомься с ними, чтобы укрепить контуры.»`;
      case 'eir':
        return `«Внимание! Агент «${agentName}» докладывает о ${findingsCount} уязвимостях в комплекте. Требуется правка!»`;
      case 'selene':
        return `«Агент «${agentName}» выявил ${findingsCount} пунктов, требующих нормативного внимания.»`;
      case 'lilith':
      default:
        return `«Агент «${agentName}» нашёл ${findingsCount} зацепок. Давай отшлифуем их до идеала!»`;
    }
  }
}

