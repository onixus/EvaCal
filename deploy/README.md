# Установка EvaCal

Каталог `deploy/` — всё, что нужно для развёртывания стенда из готовых образов
`ghcr.io/onixus/evacal` и `ghcr.io/onixus/evacal-migrate` без клонирования репозитория
и без Node.js на сервере.

| Файл                       | Назначение                                                              |
| -------------------------- | ----------------------------------------------------------------------- |
| `install.sh`               | Установщик и утилита управления (`evacal …`)                            |
| `docker-compose.yml`       | Стек: PostgreSQL 16 → migrate (миграции + сид) → app → nginx            |
| `docker-compose.tls.yml`   | Наложение HTTPS: порт 443 и сертификаты из `certs/`                     |
| `docker-compose.build.yml` | Наложение «из исходников»: сборка образов из клона вместо pull          |
| `nginx/https.conf`         | nginx с TLS, редирект HTTP → HTTPS, HSTS и заголовки безопасности       |
| `nginx/http.conf`          | nginx без TLS (`--no-tls`, когда TLS терминирует внешний балансировщик) |

## Требования

- Linux x86-64 / arm64 (Debian, Ubuntu, RHEL-семейство, Astra Linux, РЕД ОС) или macOS для локального стенда.
- Docker Engine 24+ с плагином Compose v2. Если Docker нет, установщик на Linux предложит поставить его официальным скриптом `get.docker.com`.
- 2 CPU, 4 ГБ ОЗУ, 10 ГБ диска. Доступ к `ghcr.io` (или клон репозитория для сборки из исходников).
- `curl` и `openssl` (для загрузки конфигурации и самоподписанного сертификата).

## Установка одной командой

```bash
curl -fsSL https://raw.githubusercontent.com/onixus/EvaCal/main/deploy/install.sh | sudo bash
```

Установщик:

1. проверит Docker и Compose;
2. разложит конфигурацию в `/opt/evacal` (для непривилегированного пользователя — `~/evacal`);
3. сгенерирует `.env` со случайными `SESSION_SECRET`, `SHARE_TOKEN_SECRET` и паролем PostgreSQL (секреты создаются один раз и при повторных запусках не меняются);
4. выпустит самоподписанный сертификат на имя хоста, если не переданы `--cert/--key`;
5. загрузит образы, применит миграции, засеет пресеты и учётные записи, дождётся ответа `/api/health`;
6. напечатает пароли стендовых учёток (`admin`, `architect`, `gap`, `techwriter`, `presale`, `reviewer`) и сохранит их в `credentials.txt` (права 600). При первом входе пароль нужно сменить.

Параметры передаются после `bash -s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/onixus/EvaCal/main/deploy/install.sh \
  | sudo bash -s -- install --domain evacal.corp.local --version 0.6.0 \
      --cert /etc/ssl/evacal/fullchain.pem --key /etc/ssl/evacal/privkey.pem
```

| Параметр                          | Значение                                                                    |
| --------------------------------- | --------------------------------------------------------------------------- |
| `--dir DIR`                       | каталог установки (`/opt/evacal` или `~/evacal`)                            |
| `--version TAG`                   | тег образов: `latest` (по умолчанию), `0.6.0`, `main`                       |
| `--domain HOST`                   | DNS-имя или IP стенда; под него выпускается сертификат и печатается адрес   |
| `--http-port N`, `--https-port N` | порты nginx на хосте (80 / 443)                                             |
| `--no-tls`                        | только HTTP: TLS терминирует внешний прокси или стенд в доверенной сети     |
| `--cert FILE --key FILE`          | свой сертификат (полная цепочка) и ключ                                     |
| `--database-url URL`              | внешний PostgreSQL вместо встроенного контейнера                            |
| `--sqlite`                        | встроенный SQLite для одного небольшого стенда (только вместе с `--source`) |
| `--source [PATH]`                 | собрать образы из клона репозитория вместо загрузки из `ghcr.io`            |
| `--seed-password P`               | один известный пароль на все учётки — только для тестового стенда           |
| `-y`                              | без вопросов; интерактивно спрашивается только имя хоста                    |

### Из клона репозитория

```bash
git clone https://github.com/onixus/EvaCal.git && cd EvaCal
./deploy/install.sh install                 # образы из ghcr.io
./deploy/install.sh install --source        # сборка образов из этого клона
```

## Управление стендом

Копия установщика лежит в каталоге установки как `evacal` и линкуется в `/usr/local/bin/evacal`, когда есть права.

```bash
evacal status                 # состояние контейнеров, версия, адрес
evacal logs [app|web|postgres|migrate]
evacal update [--version 0.6.0]   # новые образы, миграции, перезапуск без потери данных
evacal passwords              # новые случайные пароли всем учёткам (печатаются один раз)
evacal backup                 # дамп PostgreSQL + артефакты ГОСТ 34 → backups/evacal-<дата>.tar.gz
evacal restore backups/evacal-20260922-120000.tar.gz
evacal stop | start | restart
evacal uninstall [--purge]    # --purge удаляет тома с данными и каталог установки
```

Все контейнеры запускаются с `restart: unless-stopped`: после перезагрузки сервера стенд поднимается сам, если служба Docker включена в автозапуск.

## Что где лежит

```
/opt/evacal/
├── .env                 # параметры и секреты (600)
├── docker-compose*.yml  # стек и наложения; активный набор — COMPOSE_FILE в .env
├── nginx/nginx.conf     # отрендеренный конфиг (из nginx/http.conf или nginx/https.conf)
├── certs/               # fullchain.pem, privkey.pem
├── credentials.txt      # пароли после первого сида — удалить после смены
├── backups/
└── evacal               # копия установщика
```

Данные живут в томах Docker проекта `evacal`: `pg-data` (PostgreSQL), `storage-data` (ZIP/DOCX комплектов ГОСТ 34), `db-data` (SQLite, если выбран).

## Боевой сертификат

Положите `fullchain.pem` и `privkey.pem` в `/opt/evacal/certs/` и выполните `evacal restart`.
Для Let's Encrypt удобно `certbot certonly --standalone` при остановленном стенде либо DNS-challenge,
затем `deploy`-hook, копирующий файлы в `certs/` и вызывающий `evacal restart`.

## Обновление

`evacal update` тянет образы нового тега, пересоздаёт контейнер `migrate` (он применяет
миграции `prisma migrate deploy`, сид пропускает уже существующие записи) и перезапускает
`app`. Перед мажорным обновлением снимите `evacal backup`.

## Тонкая настройка

Любые переменные из `.env.example` в корне репозитория (S3-хранилище артефактов,
LLM-провайдеры, `EVACAL_LLM_*`) добавляются в `/opt/evacal/.env`; после правки — `evacal restart`.
Лимиты контейнера приложения: `EVACAL_APP_CPUS` (2.0) и `EVACAL_APP_MEMORY` (2048M).

## Публикация образов

Оба образа собирает Jenkins-джоба `evacal-publish` (`Jenkinsfile.publish`) по тегу `vX.Y.Z`:
`ghcr.io/onixus/evacal:X.Y.Z` (+ `latest`) и `ghcr.io/onixus/evacal-migrate:X.Y.Z` (+ `latest`).
