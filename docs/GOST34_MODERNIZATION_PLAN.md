# EvaCal — план модернизации модуля ГОСТ 34

## 1. Цель

Модернизировать модуль генерации технической документации EvaCal так, чтобы он:

- формировал ТЗ по актуальной редакции ГОСТ 34.602-2020;
- поддерживал версионированные нормативные профили;
- не подменял проектные требования жёстко заданными технологиями EvaCal;
- обеспечивал происхождение, проверяемость и трассируемость требований;
- применял отраслевую и регуляторную нормативку только после анализа применимости;
- использовал LLM как инструмент нормализации и анализа, а не как источник истины;
- формировал согласованный комплект документов;
- сохранял совместимость с legacy-проектами на ГОСТ 34.602-89.

---

## 2. Целевая нормативная база

### Основной профиль

**ГОСТ 34.602-2020** — базовый стандарт для технического задания на создание автоматизированной системы.

Связанные стандарты:

- ГОСТ 34.201-2020 — виды, комплектность и обозначение документов;
- ГОСТ Р 59793-2021 — стадии создания автоматизированных систем;
- ГОСТ Р 59792-2021 — испытания автоматизированных систем;
- ГОСТ Р 59795-2021 — содержание проектной документации.

### Legacy-профиль

Для ранее созданных проектов сохранить профиль:

- ГОСТ 34.602-89;
- ГОСТ 34.201-89;
- РД 50-34.698-90.

Legacy-профиль должен использоваться только явно и не должен быть значением по умолчанию для новых проектов.

---

## 3. Архитектурная цель

```text
                Standards Registry
                        ↓
Documents → Requirements Repository ← Questionnaire
                        ↓
               Applicability Engine
                        ↓
                Requirements Model
                        ↓
                 GOST Validator
                        ↓
                Traceability Graph
                        ↓
               Document Generator
                        ↓
          TZ / PZ / AF / PMI / SPEC
                        ↓
                   DOCX Export
```

Главный принцип:

> Документ формируется из проверенной модели требований и проектного контекста, а не из набора жёстко заданных текстовых шаблонов.

---

# 4. Этапы работ

## Этап 0. Версионированные нормативные профили

**Приоритет: P0**

Создать реестр нормативных профилей.

Предлагаемая структура:

```text
lib/gost34/standards/
  registry.ts
  profiles/
    gost34-2020.ts
    gost34-legacy-89.ts
  rules/
    tz-2020.ts
    documentation-2020.ts
    lifecycle-2021.ts
    testing-2021.ts
```

Базовая модель:

```ts
interface StandardProfile {
  id: string;
  name: string;
  version: string;
  effectiveFrom: Date;

  primaryStandard: string;

  documentStandards: StandardReference[];
  regulatoryStandards: StandardReference[];

  documentTypes: DocumentProfile[];
}
```

Основной профиль:

```text
ru-gost34-current

TZ:
  ГОСТ 34.602-2020

Documents:
  ГОСТ 34.201-2020
  ГОСТ Р 59795-2021

Lifecycle:
  ГОСТ Р 59793-2021

Testing:
  ГОСТ Р 59792-2021
```

Номера стандартов не должны быть захардкожены в UI, exporter, шаблонах и именах файлов.

---

## Этап 1. Модель требований v2

**Приоритет: P0**

Текущую модель требования расширить до полноценной инженерной сущности.

```ts
interface Requirement {
  id: string;
  code: string;

  originalText: string;
  normalizedText?: string;

  category: RequirementCategory;
  type: RequirementType;

  source: {
    documentId?: string;
    filename?: string;
    page?: number;
    section?: string;
    paragraph?: string;
    hash?: string;
  };

  applicability?: ApplicabilityStatus;

  verificationMethod?: VerificationMethod;
  acceptanceCriteria?: string[];

  status: RequirementStatus;

  confidence?: number;

  createdBy?: string;
  approvedBy?: string;

  standardReferences?: StandardReference[];
  relations?: RequirementRelation[];
}
```

Обязательные свойства:

- исходный текст не изменяется;
- нормализованный текст хранится отдельно;
- сохраняется документ-источник;
- сохраняется положение требования в источнике;
- фиксируется метод проверки;
- фиксируются критерии приёмки;
- фиксируется состояние согласования;
- фиксируются связи с другими сущностями.

---

## Этап 2. Новая структура ТЗ по ГОСТ 34.602-2020

**Приоритет: P0**

Переписать генератор `tz34.ts`.

Целевая структура ТЗ:

```text
1. Общие сведения

2. Цели и назначение создания АС
   2.1 Цели создания
   2.2 Назначение АС

3. Характеристика объектов автоматизации

4. Требования к автоматизированной системе
   4.1 Требования к структуре АС в целом
   4.2 Требования к функциям (задачам)
   4.3 Требования к видам обеспечения АС
   4.4 Общие технические требования

5. Состав и содержание работ по созданию АС

6. Порядок разработки АС

7. Порядок контроля и приемки АС

8. Требования к подготовке объекта автоматизации
   к вводу АС в действие

9. Требования к документированию

10. Источники разработки

Приложения
```

Шаблон должен быть schema-driven.

Не допускается хранение всей структуры документа как большого массива статических строк.

---

## Этап 3. ProjectContext вместо жёстко заданного EvaCal-контента

**Приоритет: P0**

Удалить из шаблона ТЗ жёстко заданные сведения:

- Next.js;
- Tailwind CSS;
- Prisma;
- PostgreSQL/SQLite;
- Docker;
- CPU/RAM;
- назначение EvaCal;
- универсальные SLA/RTO/RPO.

Ввести модель проектного контекста:

```ts
interface ProjectContext {
  automationObject?: string;

  systemPurpose?: string;
  goals?: ProjectGoal[];
  measurableGoalCriteria?: GoalCriterion[];

  architecture?: ArchitectureContext;
  integrations?: IntegrationContext[];
  infrastructure?: InfrastructureContext;

  users?: UserGroup[];
  roles?: SystemRole[];

  availability?: AvailabilityRequirements;
  performance?: PerformanceRequirements;
  security?: SecurityContext;

  dataClasses?: DataClass[];

  lifecycle?: LifecycleContext;
  deploymentModel?: DeploymentModel;

  documentationRequirements?: DocumentationRequirement[];
}
```

Источники ProjectContext:

```text
опросник
+ расчёт
+ импортированные документы
+ согласованные требования
+ ручной ввод
```

Если данных нет, система должна помечать поле как требующее уточнения, а не придумывать значение.

---

## Этап 4. Applicability Engine

**Приоритет: P0**

Полностью изменить механизм нормативного обогащения.

Текущее поведение «включить всё по умолчанию» убрать.

Новая схема:

```text
ProjectContext
    ↓
Applicability Rules
    ↓
Applicable / Not Applicable / Unknown
    ↓
Evidence + Reason
    ↓
Human Confirmation
    ↓
Normative Requirements
```

Модель результата:

```ts
interface ApplicabilityResult {
  standardId: string;

  status:
    | "APPLICABLE"
    | "NOT_APPLICABLE"
    | "UNKNOWN";

  reasons: string[];
  evidence: Evidence[];

  confidence?: number;
}
```

Регуляторные требования должны появляться только при наличии основания.

Примеры контекстов:

- персональные данные;
- КИИ;
- кредитная организация;
- НФО;
- финансовая организация;
- государственная информационная система;
- ГосСОПКА;
- импортозамещение;
- требования доступности интерфейса.

---

## Этап 5. GOST Requirement Validator

**Приоритет: P0 / P1**

Реализовать формальную проверку требований.

Набор валидаторов:

```text
AtomicityValidator
AmbiguityValidator
MeasurabilityValidator
ConflictValidator
CompletenessValidator
TestabilityValidator
ApplicabilityValidator
SourceValidator
DuplicationValidator
```

Требование должно проверяться как минимум на:

- единичность;
- непротиворечивость;
- актуальность;
- выполнимость;
- проверяемость;
- однозначность.

Модель результата:

```ts
interface ValidationFinding {
  severity: "ERROR" | "WARNING" | "INFO";

  requirementId?: string;
  rule: string;

  message: string;
  suggestion?: string;
}
```

Пример:

```text
ТР-НАД-004
Система должна работать быстро.

ERROR:
Требование непроверяемо.

Причина:
Не определён измеримый показатель производительности.
```

---

## Этап 6. Traceability Engine v2

**Приоритет: P0**

Удалить fallback, который назначает требование этапу через hash.

Если связь не определена, состояние должно быть:

```text
UNMAPPED
```

Целевая модель:

```text
SOURCE
  ↓
REQUIREMENT
  ↓
TZ SECTION
  ↓
SYSTEM COMPONENT
  ↓
IMPLEMENTATION STAGE
  ↓
TEST CASE
  ↓
ACCEPTANCE RESULT
```

Модель связи:

```ts
interface TraceLink {
  sourceId: string;
  targetId: string;

  relation: TraceRelation;

  method:
    | "MANUAL"
    | "RULE"
    | "LLM";

  confidence?: number;
  approved: boolean;
}
```

Метрики:

```text
Requirements                 143
Mapped to stages             137
Mapped to tests              118
Unmapped                       6
Unverified                    25
Coverage                     82.5%
```

---

## Этап 7. LLM normalization v2

**Приоритет: P1**

LLM не должен заменять исходное требование.

Допустимые функции LLM:

- извлечение;
- классификация;
- нормализация;
- поиск дубликатов;
- выявление конфликтов;
- предложение критериев приёмки;
- предложение связей трассировки.

Недопустимые функции:

- самостоятельное создание нормативных требований;
- добавление проектных цифр без источника;
- изменение исходного текста без фиксации;
- выдумывание применимости регуляторики.

Новый workflow:

```text
Original Requirement
        ↓
LLM Proposal
        ↓
Diff / Added Facts / Removed Facts
        ↓
Human Review
        ↓
Accept / Edit / Reject
```

Автоматические флаги:

```text
LLM_ADDED_FACT
LLM_ADDED_NUMBER
LLM_REMOVED_CONSTRAINT
LLM_CHANGED_MODALITY
LLM_CHANGED_SCOPE
```

---

## Этап 8. LLM Security

**Приоритет: P0**

Закрыть потенциальный SSRF.

Пользователь не должен иметь возможность передавать произвольный серверный endpoint.

Новая схема:

```text
Configured LLM Providers
        ↓
Server-side Registry
        ↓
Allowlisted Endpoint
```

API-ключи:

- хранить на сервере;
- не сохранять в localStorage;
- не возвращать клиенту;
- поддержать encrypted settings / secrets.

Дополнительно:

- блокировать link-local;
- блокировать loopback, кроме явно разрешённых локальных моделей;
- блокировать private network targets при SaaS-развёртывании;
- валидировать протокол;
- разрешать только HTTPS для удалённых провайдеров.

---

## Этап 9. Модернизация PZ / AF / PMI / SPEC

**Приоритет: P1**

Перевести остальные документы на современный нормативный профиль.

Использовать:

```text
ГОСТ 34.201-2020
ГОСТ Р 59795-2021
ГОСТ Р 59792-2021
ГОСТ Р 59793-2021
```

Legacy-профиль сохранить отдельно.

Генераторы документов не должны содержать ссылки на старые нормативные документы, если выбран современный профиль.

---

## Этап 10. DOCX Layout Profiles

**Приоритет: P1**

Разделить:

```text
Document Content
        +
Document Layout
```

Профили оформления:

```text
gost34-modern
gost34-eskd-frame
customer-template
plain-corporate
```

Не считать рамки ЕСКД обязательными для любого документа ГОСТ 34 автоматически.

Доработать:

- титульный лист;
- лист согласования;
- содержание;
- номера страниц;
- таблицы;
- приложения;
- рисунки;
- перекрёстные ссылки;
- requirement IDs;
- журнал изменений;
- колонтитулы;
- стили документа.

---

## Этап 11. Новый UI Wizard

**Приоритет: P1**

Заменить перегруженное модальное окно последовательным wizard.

```text
1. Проект

2. Нормативный профиль

3. Объект автоматизации

4. Исходные документы

5. Требования

6. Применимость нормативов

7. Трассировка

8. Проверка ТЗ

9. Документы

10. Экспорт
```

Compliance view:

```text
Mandatory sections       10/10

Requirements            148
Valid                   129
Warnings                 15
Errors                    4

Unmapped                  3
Untestable                7
Without source            2

GOST readiness           91%
```

Финальный экспорт должен блокироваться при критических `ERROR`, если пользователь явно не выбрал режим override.

---

## Этап 12. Тестирование и миграция

**Приоритет: P0 / P1**

### Unit tests

Проверять:

- applicability rules;
- validators;
- mapping;
- conflict detection;
- requirement normalization.

### Schema tests

Проверять:

- наличие обязательных разделов;
- порядок разделов;
- обязательные поля;
- нормативный профиль.

### Golden tests

Поддерживать контрольные документы:

```text
generic corporate AS
ISPDn
KII
bank
NFO
air-gapped AS
high availability AS
simple internal system
legacy GOST 34.602-89
```

### DOCX tests

Проверять:

- структуру Word;
- заголовки;
- таблицы;
- нумерацию;
- приложения;
- титульный лист;
- отсутствие legacy-ссылок в modern profile.

---

# 5. Миграция существующих проектов

Добавить к Calculation / GeneratedDocument:

```ts
standardProfileId
standardProfileVersion
generatorVersion
generatedAt
```

Пример:

```text
старый проект
→ gost34-legacy-89@1.0

новый проект
→ ru-gost34-current@1.0
```

Для существующего проекта предусмотреть действие:

```text
Migrate to ГОСТ 34.602-2020
```

Перед миграцией показывать diff:

- структура документа;
- новые разделы;
- удалённые legacy-ссылки;
- новые требования;
- конфликты;
- неприменимые нормативы.

---

# 6. Приоритеты

| Приоритет | Работа |
|---|---|
| P0 | Standards Registry |
| P0 | ГОСТ 34.602-2020 profile |
| P0 | Новая структура ТЗ |
| P0 | Requirement v2 |
| P0 | ProjectContext |
| P0 | Applicability Engine |
| P0 | Удаление fake traceability |
| P0 | SSRF / LLM security |
| P0 | Базовый GOST Validator |
| P1 | LLM proposal workflow |
| P1 | Traceability до test cases |
| P1 | Новый UI Wizard |
| P1 | Модернизация PZ / AF / PMI / SPEC |
| P1 | DOCX layout profiles |
| P1 | Regression suite |
| P2 | Автогенерация acceptance criteria |
| P2 | Version / diff документов |
| P2 | Compliance dashboards |
| P2 | Customer-specific profiles |

---

# 7. Последовательность Pull Request

## PR-01 — Standards Registry

- добавить реестр стандартов;
- добавить `ru-gost34-current`;
- добавить `gost34-legacy-89`;
- убрать hardcoded версии ГОСТ из UI и exporter.

## PR-02 — Requirement v2

- новая модель требования;
- provenance;
- immutable original text;
- migration существующих требований.

## PR-03 — ГОСТ 34.602-2020 TZ Schema

- новая структура ТЗ;
- обязательные разделы;
- schema-driven generator.

## PR-04 — ProjectContext

- модель проектного контекста;
- mapping questionnaire → context;
- mapping calculation → context;
- устранение EvaCal-specific hardcode.

## PR-05 — Applicability Engine

- rule engine;
- regulatory evidence;
- manual confirmation;
- default `UNKNOWN`, а не `true`.

## PR-06 — GOST Validator

- atomicity;
- ambiguity;
- measurability;
- conflict;
- completeness;
- testability;
- source validation.

## PR-07 — Traceability v2

- удалить hash fallback;
- `UNMAPPED`;
- confidence;
- manual approval;
- coverage metrics.

## PR-08 — LLM v2 + Security

- proposal-based normalization;
- diff;
- hallucination flags;
- endpoint allowlist;
- secure secrets.

## PR-09 — DOCX Modern Layout

- modern profile;
- layout profiles;
- content/layout separation;
- TOC;
- numbering;
- appendices.

## PR-10 — UI Wizard

- пошаговый workflow;
- compliance screen;
- requirement review;
- applicability review;
- traceability review.

## PR-11 — PZ / AF / PMI / SPEC

- modern profiles;
- обновлённые документы;
- modern / legacy separation.

## PR-12 — Regression Suite + Migration

- unit;
- schema;
- golden;
- DOCX tests;
- migration UI;
- documentation.

---

# 8. Definition of Done

Модернизация считается завершённой, когда выполняются следующие условия.

### Нормативный профиль

- новые проекты используют ГОСТ 34.602-2020;
- версия профиля фиксируется в проекте;
- legacy-проекты воспроизводимы.

### ТЗ

- присутствуют все обязательные разделы современного профиля;
- порядок разделов проверяется автоматически;
- отсутствуют EvaCal-specific технологии без проектного основания.

### Требования

- каждое импортированное требование сохраняет оригинал;
- каждое требование имеет источник либо явно маркируется как ручное;
- LLM не изменяет оригинал;
- требования проверяются на непротиворечивость и проверяемость.

### Нормативная применимость

- ни один отраслевой норматив не применяется автоматически без основания;
- применение нормы содержит причину и evidence;
- `UNKNOWN` является допустимым состоянием.

### Трассировка

- отсутствуют фиктивные связи;
- неподтверждённые связи видны пользователю;
- считается coverage.

### LLM

- LLM работает в proposal mode;
- добавленные факты выявляются;
- endpoint защищён от SSRF;
- secrets не хранятся в localStorage.

### Документы

- TZ / PZ / AF / PMI / SPEC используют выбранный нормативный профиль;
- DOCX exporter отделён от модели содержания;
- modern profile не содержит ссылок на legacy ГОСТ без явного основания.

### Тесты

- unit coverage покрывает критические rules;
- есть schema regression;
- есть golden documents;
- есть DOCX structural tests.

---

# 9. Результат

После выполнения плана модуль должен перейти от модели:

```text
данные
→ текстовые шаблоны
→ Word
```

к модели:

```text
источники
→ проектный контекст
→ требования
→ применимость нормативов
→ валидация
→ трассировка
→ модель документа
→ экспорт
```

Целевая роль EvaCal:

> система инженерии требований и подготовки нормативной проектной документации, а не генератор Word-файлов, внешне похожих на документы по ГОСТ.
