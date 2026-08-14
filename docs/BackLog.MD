# EvaCal Product Backlog & Horizon Roadmap

## 🏁 Completed Milestones

### 1. GOST 34 Generator & Modern Standards

- [x] Full support for **ГОСТ 34.602-2020** & **ГОСТ 34.201-2020** + legacy **РД 50-34.698-90**.
- [x] Complete 5-document set (TZ, PZ, AF, PMI, SPEC).
- [x] ESKD stamp frames (ГОСТ 2.104-2006 Form 2 and 2a) with precise margin offsets.
- [x] 7-step interactive wizard pipeline (`profile` → `requirements` → `applicability` → `traceability` → `signatures` → `preview` → `compliance`).
- [x] Live Split-Screen AST preview & Inline Editor with override badges and export integration.

### 2. Industry Presets & Russian Domain Knowledge

- [x] NGFW (UserGate) preset with HA clusters, FSTEK certificate #3905, 188-FZ Registry #1199.
- [x] Hardware & PAC (YADRO Vegman / Aquarius / All-Flash NVMe TATLIN) preset with Minpromtorg Registry (PP RF #878/#719).
- [x] Endpoint Security (Kaspersky) preset with FSTEK certificate #4238.
- [x] Unstructured Data Audit (Cyberpeak) preset with Registry #12590.
- [x] GOST-VPN (ViPNet) preset with FSB (KS1/KS2/KS3) and FSTEK #4118 certificates.
- [x] OS & DBMS (Astra Linux SE, Postgres Pro Enterprise) with FSTEK certificates.

### 3. Traceability Engine & Multi-Channel Matrices

- [x] 5-level requirement-to-stage and requirement-to-PMI matching engine.
- [x] Dedicated 13-column Traceability Matrix sheet in Excel export (`.xlsx`).
- [x] Interactive Traceability Matrix UI panel with category grouping and status metrics.

### 4. Commercial Proposals, Roles & Scenarios

- [x] Comprehensive role grid (Architect/GAP, Lead/Senior Engineers, Lead Analysts, Consultants, Security Experts, Developers, PM).
- [x] Commercial estimate calculation (direct labor cost, overhead, margin, discount, VAT).
- [x] Scenario modeling (Target, Best Case, Worst Case).
- [x] Interactive GANTT timeline with customer approval task automation.

### 5. Equipment & Software Specification (SPEC)

- [x] GOST 34 Specification document generator (188-FZ software registry, Minpromtorg hardware registry, 42U racks, ZIP sets).
- [x] Interactive UI Specification tab and panel with instant DOCX export.

### 6. Security, RBAC & CI/CD

- [x] Strict RBAC (Architect & Admin protected routes).
- [x] Local LLM Normalizer with safe endpoint guard.
- [x] Jenkins CI/CD pipeline with JUnit XML reporting (`test:ci`).
- [x] Automated test suite: 36 files, 338 tests (100% pass).

---

## 🗂 Next Horizon — Реестр выпуска (закрытие Horizon B)

Полный план: [RELEASE_REGISTRY_PLAN.md](RELEASE_REGISTRY_PLAN.md).

Цель: один проект = одна правда. Расчёт, смета, требования и комплект ГОСТ — версии одного объекта; утверждённый ZIP воспроизводится по checksum.

- [ ] **RR-1** Проект как первый экран (`/projects`, карточка, навбар).
- [ ] **RR-2** Снимок мастера в `GostPackage` (требования v2, trace-links, применимость, overrides).
- [ ] **RR-3** Неизменяемый ZIP + обязательный SHA-256; экспорт падает, если пакет не записался.
- [ ] **RR-4** Согласование комплекта по share-ссылке (`review`), без staff-логина.
- [ ] **RR-5** Структурный diff двух версий пакета.
- [ ] **RR-6** Playwright e2e «Северный банк» (login → пресет → выпуск → approve → тот же checksum).

Не в этом горизонте: Postgres, multi-tenant, очередь генерации, ПСИ/акт, новые пресеты. LLM-автор ТЗ спроектирован отдельно и идёт после RR-2 (снимок пакета).

---

## 📝 Designed — LLM как автор ТЗ (после RR-2)

Принятый дизайн: [LLM_TZ_AUTHOR_DESIGN.md](LLM_TZ_AUTHOR_DESIGN.md).

LLM пишет **черновики разделов** по `SchemaNode.id`. Человек Accept / Edit / Reject. В ZIP только `ACCEPTED` / `ACCEPTED_EDITED`. Схема `TZ_SCHEMA_2020` остаётся baseline; LLM не renderer и не юридический автор.

- [ ] **PR-01** Shared LLM client + флаг `EVACAL_LLM_TZ_AUTHOR` (prod off).
- [ ] **PR-02** Overlay по `nodeId`, нумерация пунктов на сервере.
- [ ] **PR-03** Grounding pack + промпт `tz-author-v1`.
- [ ] **PR-04** `detectDraftFlags` + eval-фикстуры (без сети).
- [ ] **PR-05** `POST /api/gost34/draft-tz` (один раздел, staff).
- [ ] **PR-06a** Persist в мастере, preview, export 409 на hard-флагах.
- [ ] **PR-06b** Снимок в `GostPackage` — **после RR-2**.
- [ ] **PR-07** Side-by-side ревью в предпросмотре.
- [ ] **PR-08** Клиентский batch «весь ТЗ».
- [ ] **PR-09** Eval-гейт в CI.
- [ ] **PR-10** Redact audit + injection tests.

---

## 🔮 Later Horizon Roadmap

- [ ] Acceptance Testing Protocol (ПСИ / Акт приемки) document generator — после реестра выпуска.
- [ ] Semantic document diff (LLM-assisted) — после структурного diff RR-5.
- [ ] Multi-tenant workspace isolation — Horizon C.
