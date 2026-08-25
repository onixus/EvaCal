import { Gost34InputPayload, Gost34Section } from '../types';

export function buildRA34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const ctx = payload.projectContext;
  const citations = payload.standardProfile.citations;

  const archStyle =
    ctx?.architecture?.style || 'Контейнеризированная микросервисная архитектура (Docker / Nginx)';
  const platforms =
    ctx?.infrastructure?.platforms?.join(', ') ||
    'Astra Linux / Alt Linux / Ubuntu Server, Docker, PostgreSQL / SQLite';

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ВВЕДЕНИЕ И ОБЩИЕ СВЕДЕНИЯ ОБ АРХИТЕКТУРЕ',
      paragraphs: [
        `1.1 Настоящее Руководство системного администратора определяет порядок развертывания, настройки, сопровождения и мониторинга системы «${meta.systemName}».`,
        `1.2 Обозначение документа: ${meta.documentCode}. Документ разработан в соответствии со стандартами ${citations.projectDocumentation}.`,
        `1.3 Архитектурная модель: ${archStyle}. Целевые платформы: ${platforms}.`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'ТРЕБОВАНИЯ К КВАЛИФИКАЦИИ И ПРАВАМ АДМИНИСТРАТОРА',
      paragraphs: [
        '2.1 Администратор системы должен обладать квалификацией в области администрирования Linux, Docker/Compose, веб-серверов (Nginx) и реляционных СУБД.',
        '2.2 Для выполнения регламентных процедур администратору требуются права суперпользователя (root / sudo) на сервере приложений.',
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'УСТАНОВКА, РАЗВЕРТЫВАНИЕ И КОНФИГУРИРОВАНИЕ',
      paragraphs: [
        '3.1 Развертывание осуществляется с использованием готовых OCI-контейнеров через Docker Compose.',
        '3.2 Порядок запуска:\n1) Выполнить синхронизацию схемы БД и сидирование: docker compose --profile tools run --rm migrate\n2) Запустить сервис в фоновом режиме: docker compose up -d\n3) Проверить статус контейнеров: docker compose ps',
        '3.3 Конфигурационные параметры и переменные окружения задаются в файле .env (SESSION_SECRET, DATABASE_URL, ALLOW_ANONYMOUS_PRESALE).',
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'УПРАВЛЕНИЕ УЧЕТНЫМИ ЗАПИСЯМИ И БЕЗОПАСНОСТЬ',
      paragraphs: [
        '4.1 Управление пользователями осуществляется через административную панель (/admin/users).',
        '4.2 Поддерживаются роли: admin, architect, presale. Передача паролей осуществляется по защищенному каналу с принудительной сменой при первом входе.',
        '4.3 Журнал событий безопасности доступен в таблице AuditEvent и фиксирует действия пользователей, IP-адреса и изменения настроек.',
      ],
    },
    {
      id: 'sec-5',
      numStr: '5',
      title: 'РЕЗЕРВНОЕ КОПИРОВАНИЕ, МОНИТОРИНГ И ВОССТАНОВЛЕНИЕ',
      paragraphs: [
        '5.1 Резервному копированию подлежат каталог БД (том db-data:/app/prisma) и конфигурационные файлы (.env, nginx.conf).',
        '5.2 Регламент резервного копирования: ежедневный полный бэкап (Full Backup) с глубиной хранения 30 дней.',
        '5.3 Мониторинг состояния сервиса выполняется через эндпоинт /api/health (HTTP 200) и журналы контейнеров docker compose logs.',
      ],
    },
  ];
}
