# EvaCal Product Backlog & Horizon Roadmap

## 🏁 Completed Milestones

### 1. GOST 34 Generator & Modern Standards

- [x] Full support for **ГОСТ 34.602-2020** & **ГОСТ 34.201-2020** + legacy **РД 50-34.698-90**.
- [x] Complete 5-document core set (TZ, PZ, AF, PMI, SPEC).
- [x] Acceptance testing documents: **ПСИ** (Программа и методика испытаний) and **Акт приёмки в опытную/промышленную эксплуатацию**.
- [x] ESKD stamp frames (ГОСТ 2.104-2006 Form 2 and 2a) with precise margin offsets and modern profile `gost34-modern`.
- [x] 7-step interactive wizard pipeline (`profile` → `requirements` → `applicability` → `traceability` → `signatures` → `preview` → `compliance`).
- [x] Live Split-Screen AST preview & Inline Editor with override badges and export integration.

### 2. Industry Presets & Russian Domain Knowledge

- [x] Dedicated NGFW implementation preset with HA, segmentation, rule migration, security services and SIEM integrations; legacy combined NGFW/SZI preset retained.
- [x] Hardware & PAC (YADRO Vegman / Aquarius / All-Flash NVMe TATLIN) preset with Minpromtorg Registry (PP RF #878/#719).
- [x] SIEM / SOC implementation preset with source onboarding, EPS sizing, custom connectors, correlation rules, response procedures and optional ГосСОПКА integration.
- [x] IDM / IGA implementation preset with identity sources, Joiner/Mover/Leaver, RBAC/SoD, provisioning, recertification and target-system integrations.
- [x] Unstructured Data Audit (Cyberpeak) preset with Registry #12590.
- [x] GOST-VPN (ViPNet) preset with FSB (KS1/KS2/KS3) and FSTEK certificates.
- [x] OS & DBMS (Astra Linux SE #2557, Postgres Pro Enterprise #4063) with FSTEK certificates.
- [x] Import substitution presets (zVirt, ALD Pro, RED OS, Oracle/MS SQL → Postgres Pro).

### 3. Traceability Engine & Multi-Channel Matrices

- [x] 5-level requirement-to-stage and requirement-to-PMI matching engine.
- [x] Dedicated 13-column Traceability Matrix sheet in Excel export (`.xlsx`) with CWE-1236 formula injection protection.
- [x] Interactive Traceability Matrix UI panel with category grouping and status metrics.

### 4. Commercial Proposals, Roles & Scenarios

- [x] 4 distinct platform roles (`presale`, `architect`, `reviewer`, `admin`) with dedicated home dashboards and badge queues.
- [x] Production role matrix (Architect/GAP, Lead/Senior Engineers, Lead Analysts, Consultants, Security Experts, Developers, PM).
- [x] Commercial estimate calculation (direct labor cost, overhead, margin, discount, VAT, zero-division safeguards).
- [x] Scenario modeling (Target, Best Case, Worst Case).
- [x] Interactive GANTT timeline with customer approval task automation.
- [x] Calibration by similar approved projects (reference-class forecasting): Gower similarity over questionnaire answers, median formula→approved ratio, per-stage adjustments, anonymised for share-link guests (`lib/calibration.ts`, `GET /api/calculations/:id/calibration`).

### 5. Equipment & Software Specification (SPEC)

- [x] GOST 34 Specification document generator (188-FZ software registry, Minpromtorg hardware registry, 42U racks, ZIP sets).
- [x] Interactive UI Specification tab and panel with instant DOCX export.

### 6. Security, RBAC & CI/CD

- [x] Strict RBAC across 4 roles (`presale`, `architect`, `reviewer`, `admin`) and HMAC-SHA256 signed share-tokens with granular scopes.
- [x] Server-side session revocation map with TTL cleanup for logout and password change invalidation.
- [x] SSRF-protected LLM endpoint guard (loopback allowed for Ollama/LM Studio; RFC 1918 private IPs blocked by default; link-local and cloud metadata unconditionally blocked).
- [x] Audit trail (`AuditEvent`) with sensitive LLM prompt/completion redaction (`redactLlmMeta`).
- [x] Docker multi-stage Alpine deployment with automated schema sync/seed and non-root runner (uid 1001).
- [x] Jenkins CI/CD pipeline and GitHub Actions workflow with JUnit XML reporting (`test:ci`).
- [x] Automated test suite: **71 test files, 594 tests (100% pass)**.

---

### 7. UI: конвейер проекта и единый набор экранов

- [x] Жизненный цикл проекта как одна шкала (`lib/lifecycle.ts`): расчёт → согласование → утверждена → комплект → нормоконтроль → ревью ГАП → выпущен → сделка; для каждого проекта — текущий шаг, дней на шаге, тревога (возвращён / завис / пауза) и следующее действие.
- [x] Рабочий стол `/` (конвейер по портфелю, очередь роли, зависшие проекты), степпер на карточке проекта, колонка «Этап» и фильтр по этапу в `/projects`, архив расчётов вынесен в `/calculations`.
- [x] Единый UI-кит: `PageHeader`, `FilterChips`/`SearchField` (фильтры живут в URL и сразу перерисовывают данные), классы `.page`, `.tab-bar`, `.table-list`, `.filter-chip`; компактные кнопки по умолчанию; сгруппированный сайдбар.
- [x] Канбан-доска заявок `/board` для архитектора, тех.писателя и ГАП: дорожка смет (черновик → на утверждении → утверждена, перетаскивание = утверждение архитектором через `POST /api/calculations/:id/approve`) и дорожка комплектов: колонки черновик → нормоконтроль → ревью ГАП → возвращён / утверждён, перетаскивание карточки = вердикт на своём этапе (через `POST /api/gost34/packages/:id/review`), сроки на этапе и блокеры на карточке.
- [x] Тема Dark Fantasy и её спутники (компаньон, пасхалка, витрина героинь) удалены; остались светлая и тёмная (Nord).

---

## 🗂 Horizon B — Реестр выпуска ГОСТ 34 (Release Registry)

Полный план: [RELEASE_REGISTRY_PLAN.md](RELEASE_REGISTRY_PLAN.md).

Цель: один проект = одна правда. Расчёт, смета, требования и комплект ГОСТ — версии одного объекта; утверждённый ZIP воспроизводится по checksum.

- [x] **RR-1** Проект как первый экран (`/projects`, карточка, навбар, привязка расчётов).
- [x] **RR-2** Снимок мастера в `GostPackage.snapshot` (требования v2, trace-links, применимость, signatures, sectionOverrides, tzAuthor).
- [x] **RR-3** Неизменяемый ZIP + обязательный SHA-256; хранилище артефактов на диске (`lib/gost34/artifactStorage.ts`), экспорт падает, если пакет не записался.
- [x] **RR-4** Согласование комплекта по share-ссылке (`review`), портал Заказчика без staff-логина, аудит и иммутабельность утверждённых версий.
- [x] **RR-5** Структурный diff двух версий пакета (`/api/projects/:id/packages/diff`: дельта требований, профиля, покрытия, стандартов, оверрайдов).
- [x] **RR-6** Playwright e2e «Северный банк» (`e2e/severny-bank-release.spec.ts`: login → пресет → выпуск → approve → воспроизводимость checksum).

---

## 🤖 Модуль «LLM как автор ТЗ» (ГОСТ 34.602-2020)

Принятый и реализованный дизайн: [LLM_TZ_AUTHOR_DESIGN.md](LLM_TZ_AUTHOR_DESIGN.md).

Контролируемый слой генерации текста разделов ТЗ по схеме `TZ_SCHEMA_2020`: человек Accept / Edit / Reject. В итоговый комплект DOCX/ZIP попадают только принятые формулировки (`ACCEPTED`). Детерминированная схема остаётся baseline ground truth.

- [x] **PR-01** Shared LLM client + флаг `EVACAL_LLM_TZ_AUTHOR` (`lib/gost34/llm/tzAuthor/flag.ts`).
- [x] **PR-02** Overlay по `nodeId`, детерминированная нумерация пунктов на сервере.
- [x] **PR-03** Grounding pack (`lib/gost34/llm/tzAuthor/grounding.ts`) + промпт `tz-author-v1` с защитой от галлюцинаций.
- [x] **PR-04** `detectDraftFlags` + оффлайн eval-фикстуры (проверка выдуманных норм, чисел, модальности).
- [x] **PR-05** `POST /api/gost34/draft-tz` (генерация черновика одного узла схемы, staff-only).
- [x] **PR-06a** Персистентность в состоянии мастера, предпросмотр, экспортный гейт с HTTP 409 на hard-флагах.
- [x] **PR-06b** Снимок предложений в `GostPackage.snapshot` (интеграция со снимком пакета).
- [x] **PR-07** Side-by-side ревью черновика в шаге предпросмотра (`TzDraftReviewPanel.tsx`).
- [x] **PR-08** Последовательный клиентский batch «Сформировать черновик всего ТЗ» (`useTzAuthorBatch.ts`).
- [x] **PR-09** Тестовый харнесс качества (Eval Suite, 15 тестов) в CI.
- [x] **PR-10** Санитизация метаданных аудита (`redactLlmMeta`) + тесты на prompt injection и SSRF.

---

## 🔮 Later Horizon Roadmap

### Horizon C — Платформа данных и Multi-Tenant (P1)

- [x] Dual-mode SQLite → PostgreSQL адаптер с миграциями Prisma для высоконагруженных развёртываний (провайдер по `DATABASE_URL`/`DATABASE_PROVIDER`, `lib/prisma.ts` выбирает адаптер, `prisma/postgresql/` — порождаемая схема и миграции, `npm run db:sync`, сервис `postgres` в docker-compose по умолчанию; CI (Jenkins) гоняет тесты, сборку и e2e против PostgreSQL, поднимаемого внутри агента `scripts/ci-postgres.sh`).
- [ ] Multi-tenant изоляция (`tenantId` / организация на сущностях проекта, пользователей и расчётов).
- [ ] Очередь фоновых задач генерации тяжелых комплектов (BullMQ / Redis / pg-boss) для предотвращения таймаутов.
- [x] Внешнее объектное хранилище артефактов (S3 / MinIO) для неизменяемых ZIP-пакетов (`lib/gost34/storage.ts`: бэкенды `fs` и `s3` за одним интерфейсом, выбор по `S3_BUCKET`/`GOST_PACKAGE_STORAGE`, профиль `minio` и том `storage-data` в docker-compose).
- [ ] Prometheus / OpenTelemetry метрики генерации и доступности LLM-провайдеров.

### Horizon E — Бизнес-фичи: замкнуть цикл обучения и планирования (P1) — **ВЫПОЛНЕН**

Проект: [BUSINESS_FEATURES_DESIGN.md](BUSINESS_FEATURES_DESIGN.md). Реализовано в PR #78 (E1), #79 (E2), #80 (E3).

- [x] **E1-1** Факт и исход сделки: `Project.dealStatus`/причина/сумма/версия, `Stage.actualHours`, блок «Сделка» в карточке проекта, колонка «Факт» у выигранной версии.
- [x] **E1-2** Аналитика `/analytics`: win rate, причины проигрышей, скидка/исход, точность оценок по шаблонам и ролям; третий слой «факт» в калибровке и точность в рейтинге.
- [x] **E1-3** CSV-импорт факта по этапам (`POST /api/calculations/:id/actuals/import`, dry-run с отчётом о несовпадениях; заготовка под Jira/YouTrack, D2).
- [x] **E2-1** Ресурсный план `/capacity`: `RoleCapacity`, `lib/capacity.ts`, тепловая карта роль × неделя (твёрдый / с воронкой), админка ёмкости.
- [x] **E2-2** Предупреждения о перегрузе в Ганте архитектора (`GET /api/calculations/:id/capacity-warnings`) и what-if со сдвигом расчётов (`POST /api/capacity/what-if`, применение через PATCH startDate).
- [x] **E3-1** Контроль сроков проекта: факт дат по этапам, статус этапа (план / в работе / просрочен / завершён), сдвиги и прогноз окончания на карточке проекта и в панели факта (`lib/schedule.ts`).
- [x] **E3-2** Отклонения по одинаковым задачам: ключ задачи без регистра и номера, каталог задач с медианой отклонения, диверджентный график на вкладке `/analytics?tab=deviations` (`lib/deviations.ts`).
- [x] **E3-3** Конструктор срезов `/analytics/deviations`: выбор задач, фильтры (роль, шаблон, архитектор, заказчик, период исхода), группировка, метрика (медиана / среднее / P90), часы или дни, допуск; сохранённые срезы (`DeviationReport`), выгрузка xlsx.
- [x] **E2-3** Выгрузка матрицы в xlsx (`GET /api/capacity/xlsx`); веса воронки — константы `WEIGHTS` в `lib/capacity.ts`, замена на win rate из E1 отложена до накопления решённых сделок (нужно ≥ 5 на бакет).

### Horizon D — Интеллектуальный дифференциал и интеграции (P2)

- [ ] Семантический анализ изменений документов с помощью LLM (LLM-assisted semantic diff поверх структурного diff RR-5).
- [ ] Интеграция с трекерами задач (Jira, YouTrack) и корпоративными базами знаний (Confluence).
- [ ] Импорт/экспорт смет и расценок из 1С / корпоративного Excel.
- [ ] Автономный Air-Gap дистрибутив для полностью изолированных защищённых контуров КИИ.
