# Claude Code Project Export

Дата экспорта: `2026-04-21`

Источник данных:

- исходники из `D:\Operator-OS-Dev`
- проектная документация в `docs/`
- инфраструктурные файлы в `infra/`
- фактически зафиксированный status из `docs/PASS2_STATUS.md` и `docs/PASS3_STATUS.md`
- подтвержденные cloud-state артефакты, уже отраженные в репозитории

Правило интерпретации:

- если что-то прямо подтверждено кодом или docs, оно описано как факт
- если что-то не подтверждено, указано `НЕТ ДАННЫХ`
- если что-то является логическим выводом из репозитория, это помечено как `ИНФЕРЕНС`

---

## 1. ОБЩАЯ КОНЦЕПЦИЯ ПРОЕКТА

### Полное название проекта

- `Operator OS Dev`

### Идея проекта в одном абзаце

`Operator OS Dev` — это phone-first trusted operator system: мобильный операторский контур, через который пользователь видит состояние desktop-агентов, backend runtime, cloud-зависимостей, сессий, alert-ов, cost-сигналов и approval flow, а затем запускает только явные, видимые и контролируемые действия. Это не stealth remote desktop и не скрытый takeover-инструмент.

### Идея проекта в 5 абзацах с деталями

Первый слой идеи — заменить “слепой” удаленный доступ контролируемой операторской моделью. В обычных remote desktop системах пользователь часто мыслит через экран и ввод, а не через состояние системы. Здесь первичен не remote stream, а operator control plane: мобильный интерфейс, показывающий здоровье рантайма, устройства, открытые сессии, pending actions, расходы и деградации зависимостей.

Второй слой — mobile-first. Проект исходит из предпосылки, что оператор должен иметь возможность быстро оценить систему с телефона, не открывая ноутбук и не подключаясь по тяжелому UI. Поэтому backend отдает typed dashboard, mobile shell работает с loading/empty/error/fallback состояниями, а система не притворяется “живой”, если она в bootstrap или degraded режиме.

Третий слой — trusted и visible control. В репозитории многократно зафиксировано, что продукт не должен превратиться в spyware, hidden control channel, keylogger или silent takeover. Любая session-модель должна быть видимой, approvals — явными, а ограничения — документированными. Даже controlled fallback рассматривается не как временный девелоперский костыль, а как часть trust model: если что-то не готово, продукт должен честно это сказать.

Четвертый слой — GCP-first control plane. Вся текущая продуктовая форма завязана на Google Cloud: Cloud Run как runtime, Firestore как оперативное хранилище control-state, Pub/Sub и Cloud Tasks как event/dispatch primitives, BigQuery как аналитический канал, Secret Manager как хранилище секретов, Vertex AI / Gemini как единственный LLM runtime. В продукт специально не добавлены GKE, OpenAI runtime, Postgres/Prisma, чтобы не распылять архитектуру на ранней фазе.

Пятый слой — operator intelligence. Система проектируется не только как панель мониторинга, но и как место, где AI объясняет текущее состояние: summarize operator state, explain agent activity, suggest cost optimizations, plan task breakdown. То есть продуктовая траектория идет не к “удаленному рабочему столу”, а к операторскому orchestration plane с explainability и cost-awareness.

### Целевая аудитория

Подтвержденной go-to-market сегментации в repo нет. Ниже — `ИНФЕРЕНС` по текущей архитектуре.

`ИНФЕРЕНС`:

- solo-founder / owner-operator, управляющий несколькими рабочими desktop/runtime средами
- small ops / infra team, которая хочет видеть состояние удаленных машин и cloud runtime с телефона
- AI-heavy operator, который запускает агентов/рантаймы и хочет видеть cost, alerts, sessions, approvals в одном месте
- команды, которым важны auditability, visibility и explicit approvals, а не “невидимый доступ”
- environments, где важна trusted-control модель и где скрытое управление неприемлемо

Подробный портрет:

- технически подкованный пользователь
- уже живет в GCP или хочет GCP-first стек
- работает с remote runtimes, агентами, задачами и затратами
- хочет управлять системой вне ноутбука, быстро, через phone UI
- не хочет использовать spyware-like tooling и нуждается в безопасно объяснимой архитектуре

### Проблема, которую решает проект

Проект решает связку проблем:

- фрагментированное управление remote runtimes, агентами и cloud services
- отсутствие mobile-first operator view
- слабая explainability того, что делают агенты и почему backend находится в том или ином состоянии
- неявные и недоверенные модели remote control
- отсутствие единого места, где одновременно видны device state, sessions, alerts, cost posture, cloud readiness и command flow

### Уникальное торговое предложение (USP)

Подтвержденного маркетингового формулирования в repo нет. Ниже — `ИНФЕРЕНС`.

`ИНФЕРЕНС`:

- phone-first operator control plane вместо desktop-first remote access
- explicit trusted session model вместо hidden takeover
- typed control-plane data contracts сквозь mobile, API и desktop-agent
- GCP-native архитектура без смешения нескольких AI/runtime провайдеров
- честный degraded/fallback режим вместо подделки live-state

### Конкуренты и чем мы отличаемся

Подтвержденного конкурентного анализа в repo нет. Ниже — `ИНФЕРЕНС`.

Возможные конкурентные категории:

- `TeamViewer`, `AnyDesk`, `Chrome Remote Desktop`, `Splashtop`
- RMM/MDM панели
- observability/ops dashboards
- custom internal control planes

Отличия проекта:

- проект не строится как просто remote desktop
- мобильный интерфейс является первичной операторской поверхностью
- visibility и trusted approvals — часть архитектурных ограничений
- cost / sessions / alerts / AI explainability встроены в саму концепцию
- Cloud Run + Vertex + Firestore + Tasks + Pub/Sub образуют единый control-plane stack, а не набор разрозненных внешних интеграций

### Монетизация и бизнес-модель

Подтвержденной бизнес-модели в репозитории нет.

- Подтвержденный статус: `НЕТ ДАННЫХ`
- `ИНФЕРЕНС`: вероятная модель — B2B/SaaS или owner-operator subscription с тарификацией по устройствам, сессиям, consumption или premium operator features

### Текущая стадия проекта

Фактическая стадия:

- pre-production
- integration foundation
- live deployment foundation partially validated

Более точно:

- monorepo bootstrap завершен
- scaffold всех трех runtimes завершен
- API перешел из чистого scaffold в live-ready integration foundation
- первая реальная Cloud Run deployment path уже подтверждена
- локальный Docker path все еще не закрыт
- live validation всех GCP integrations еще не завершена

То есть это не production и не полноценная beta. Самая честная формулировка: `advanced bootstrap / pre-MVP integration phase`.

### Финансирование: сколько получили, от кого, на что потрачено

- `НЕТ ДАННЫХ`

### Долгосрочная цель / vision на 1, 3, 5 лет

Подтвержденного product roadmap на 1/3/5 лет в repo нет. Ниже — `ИНФЕРЕНС`, собранный из `docs/ROADMAP.md` и общей архитектуры.

На 1 год:

- довести trusted control plane до полноценного MVP
- закрыть live GCP integrations
- сделать мобильный shell usable для реального operator monitoring
- довести command, approval, session, export pipelines до честной end-to-end работы

На 3 года:

- построить зрелый trusted runtime orchestration system для нескольких устройств/агентов
- добавить аналитический и explainability слой поверх сессий, расходов, деградаций и approvals
- превратить control plane в ежедневный операторский инструмент

На 5 лет:

- стать полноценной trusted operations platform для управления hybrid desktop/cloud agent runtimes
- дать пользователю прозрачный, auditable control layer над automation/AI workload
- закрепить security-first альтернативу stealth-style удаленным инструментам

---

## 2. ТЕХНИЧЕСКИЙ СТЕК

### Frontend

Основной frontend-слой:

- mobile app: `Expo + React Native + TypeScript`

Файлы:

- `apps/mobile/package.json`
- `apps/mobile/App.tsx`
- `apps/mobile/app.json`

Ключевые версии:

- `expo ^54.0.13`
- `react ^19.1.0`
- `react-native ^0.81.4`
- `@react-navigation/native ^7.1.18`
- `@react-navigation/bottom-tabs ^7.8.1`
- `react-native-safe-area-context ^5.6.1`
- `react-native-screens ^4.18.0`
- `expo-linear-gradient ^15.0.7`
- `zustand ^5.0.8`

State management:

- `zustand`
- store: `apps/mobile/src/state/operator-store.ts`

UI kit:

- полноценного UI kit нет
- собственные базовые компоненты:
  - `apps/mobile/src/components/screen-shell.tsx`
  - `apps/mobile/src/components/section-card.tsx`
  - `apps/mobile/src/components/status-pill.tsx`
- дизайн-токены:
  - `apps/mobile/src/theme/tokens.ts`
  - `apps/mobile/src/theme/navigation-theme.ts`

Навигация:

- bottom tabs
- файл: `apps/mobile/src/navigation/root-tabs.tsx`
- экраны:
  - `Home`
  - `Devices`
  - `Sessions`
  - `Costs`
  - `Settings`

### Backend

Основной backend:

- `Node.js`
- `Fastify`
- `TypeScript`

Файлы:

- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`

Ключевые зависимости:

- `fastify ^5.6.1`
- `firebase-admin ^13.8.0`
- `@google-cloud/firestore ^8.5.0`
- `@google-cloud/pubsub ^5.3.0`
- `@google-cloud/tasks ^6.2.1`
- `@google-cloud/storage ^7.19.0`
- `@google-cloud/bigquery ^8.1.1`
- `@google-cloud/secret-manager ^6.1.1`
- `@google-cloud/vertexai ^1.10.0`
- `zod ^4.1.12`
- `dotenv ^17.2.3`

### Shared libraries

Контракты:

- пакет: `packages/contracts`
- shared Zod schemas для API / mobile / desktop-agent

Конфигурация:

- пакет: `packages/config`
- shared env parsing and validation

### База данных

Реляционной БД нет.

Текущая data model состоит из:

- `Firestore` как operational/state storage
- `BigQuery` как analytics/event sink

Firestore:

- тип: `Firestore Native`
- database: `(default)`
- location: `eur3`
- edition: `STANDARD`

Коллекции, ожидаемые кодом:

- `deviceStates`
- `operatorStates`
- `sessions`
- `alerts`
- `costSnapshots`
- `auditEvents`

BigQuery:

- dataset: `ops_analytics`
- location: `EU`

Таблицы, ожидаемые кодом:

- `cost_snapshots`
- `alert_events`
- `session_events`
- `command_events`

### Кэширование

- отдельного слоя кэширования нет
- `Redis`: не используется
- `Memcached`: не используется
- локальные in-memory overlays используются только как controlled fallback в API

### Очереди

Используются два паттерна очередей:

- `Cloud Tasks` для explicit job dispatch
- `Pub/Sub` для event fan-out

Cloud Tasks queues:

- `commands`
- `approvals`
- `exports`

Pub/Sub topics:

- `agent-events`
- `budget-events`
- `operator-alerts`
- `session-events`

### Облачная инфраструктура

Основные сервисы:

- `Cloud Run` для API runtime
- `Artifact Registry` для container images
- `Cloud Build` для remote build/deploy path
- `Firestore` для control-plane state
- `Cloud Storage` для artifacts/exports/remote payloads
- `Pub/Sub` для domain events
- `Cloud Tasks` для async dispatch
- `BigQuery` для analytics events
- `Secret Manager` для runtime secrets
- `Vertex AI` для LLM features
- `Firebase / Identity Platform` для auth foundation
- `IAM` и service accounts для least-privilege identity model
- `KMS` provisioned, но пока runtime-кодом не используется напрямую

### DevOps

CI:

- `GitHub Actions`
- файл: `.github/workflows/ci.yml`

Контейнеризация:

- `Dockerfile` для API
- файл: `apps/api/Dockerfile`

Оркестрация:

- `Cloud Run`
- `GKE`: не используется

Infra-as-files:

- `infra/cloudbuild/api.cloudbuild.yaml`
- `infra/cloud-run/api.service.yaml`
- `infra/scripts/deploy-api.ps1`
- `infra/scripts/verify-api.ps1`
- `infra/scripts/iam-bindings.ps1`
- `infra/scripts/iam-bindings.sh`

### Мониторинг и логирование

Логирование:

- API: Fastify structured logger
- desktop-agent: `pino`
- Cloud Run/Cloud Build stdout/stderr logs

Monitoring stack:

- отдельного Prometheus/Grafana/Datadog/New Relic слоя нет
- health/readiness выступают как минимальный operational signal

### Аналитика

Слой аналитики:

- BigQuery writer
- аналитические сущности: command/session/alert/cost events

Код:

- `apps/api/src/integrations/bigquery.ts`
- `apps/api/src/services/service-utils.ts`

### Почему выбран именно этот стек, какие были альтернативы

Подтверждено в `docs/DECISIONS.md`:

- monorepo на `pnpm` + `turborepo`
- TypeScript everywhere
- Fastify вместо NestJS
- Expo вместо более тяжелого мобильного bootstrap
- Vertex only вместо mixed-provider AI runtime
- Cloud Run first вместо GKE
- no Prisma/Postgres during bootstrap
- no stealth / no hidden remote control

Отклоненные или отложенные альтернативы:

- `NestJS`
- `GKE`
- `Prisma/Postgres`
- `OpenAI runtime inside product`
- скрытый remote-control behavior

---

## 3. GOOGLE CLOUD SERVICES (ДЕТАЛЬНО)

Ниже перечислены использующиеся, ожидаемые или явно предусмотренные GCP сервисы.

### 3.1 Cloud Run

- Название сервиса: `Cloud Run`
- Зачем используется: хостинг backend API `operator-os-api`
- Как настроен:
  - service: `operator-os-api`
  - region: `europe-west4`
  - auth: require authentication
  - runtime service account:
    `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`
  - latest known ready revision:
    `operator-os-api-00003-rzm`
  - known URL:
    `https://operator-os-api-m545sz2isq-ez.a.run.app`
  - also annotated URL:
    `https://operator-os-api-1016254604177.europe-west4.run.app`
- Конфигурация контейнера:
  - port: `8080`
  - cpu: `1000m`
  - memory: `512Mi`
  - timeout: `300s`
  - containerConcurrency: `80`
  - maxScale: `3`
  - minScale: `0`
- Креденшлы:
  - attached service identity
  - ADC via metadata server in Cloud Run
- Стоимость:
  - фактическая стоимость сервиса в repo не зафиксирована
  - `НЕТ ДАННЫХ`
- Лимиты и квоты:
  - instance limit not documented in repo beyond `maxScale=3`
  - project quotas: `НЕТ ДАННЫХ`
- Интеграция:
  - Artifact Registry image source
  - Secret Manager / Firestore / Tasks / PubSub / Storage / BigQuery / Vertex via runtime identity

### 3.2 Cloud Build

- Название: `Cloud Build`
- Зачем используется: remote build and optional deploy path for API
- Файлы:
  - `infra/cloudbuild/api.cloudbuild.yaml`
  - `infra/scripts/deploy-api.ps1`
- Как настроен:
  - image build
  - image push
  - conditional deploy step if `_DEPLOY=true`
- Build service account:
  - `deploy-bot@operator-os-dev.iam.gserviceaccount.com`
- Стоимость:
  - `НЕТ ДАННЫХ`
- Лимиты и квоты:
  - `НЕТ ДАННЫХ`
- Интеграция:
  - Artifact Registry
  - Cloud Run deploy
  - Cloud Storage staging/log buckets under artifacts bucket path

### 3.3 Artifact Registry

- Название: `Artifact Registry`
- Repository: `operator-os-docker`
- Location: `europe-west4`
- Format: `DOCKER`
- Зачем используется: хранение API image
- Известное image path:
  - `europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:phase3-fix2`
- Repository size at last known check:
  - около `307.175 MB`
- Vulnerability scanning:
  - disabled because `containerscanning.googleapis.com` not enabled
- Стоимость:
  - `НЕТ ДАННЫХ`
- Лимиты и квоты:
  - `НЕТ ДАННЫХ`
- Интеграция:
  - Cloud Build push
  - Cloud Run deployment source

### 3.4 Firestore

- Название: `Cloud Firestore`
- Database: `(default)`
- Type: `FIRESTORE_NATIVE`
- Region / locationId: `eur3`
- Database edition: `STANDARD`
- Free tier: `true`
- Concurrency mode: `PESSIMISTIC`
- PITR: `disabled`
- Version retention period: `3600s`
- Realtime updates: enabled
- Зачем используется:
  - device state
  - operator state snapshots
  - sessions
  - alerts
  - cost snapshots
  - audit events
- Креденшлы:
  - ADC locally
  - Cloud Run service identity in cloud
- Стоимость:
  - `НЕТ ДАННЫХ`
- Лимиты и квоты:
  - `НЕТ ДАННЫХ`
- Интеграция:
  - API repository layer in `apps/api/src/integrations/firestore.ts`
  - dashboard aggregation
  - agent heartbeat/session/alert/cost persistence

### 3.5 Cloud Storage

Используются buckets:

- `operator-os-dev-artifacts`
- `operator-os-dev-exports`
- `operator-os-dev-remote`

Общая конфигурация buckets:

- location: `EU`
- storage class: `STANDARD`
- uniform bucket-level access: `true`
- public access prevention: `enforced`
- soft delete: `604800s`

Назначение:

- `artifacts`: command payloads и build-related artifacts
- `exports`: export request metadata / export artifacts
- `remote`: future remote/session payloads

Креденшлы:

- ADC / service identity

Стоимость:

- `НЕТ ДАННЫХ`

Лимиты и квоты:

- `НЕТ ДАННЫХ`

Интеграция:

- `apps/api/src/integrations/storage.ts`
- `CommandsService` uploads command JSON
- `ExportsService` uploads export request JSON
- Cloud Build staging/log paths use artifacts bucket

### 3.6 Pub/Sub

Topics:

- `agent-events`
- `budget-events`
- `operator-alerts`
- `session-events`

Зачем используется:

- fan-out domain events from API

Файл:

- `apps/api/src/integrations/pubsub.ts`

Typed publishers:

- `publishAgentEvent(device)`
- `publishAlertEvent(alert)`
- `publishBudgetEvent(snapshot)`
- `publishSessionEvent(session)`

Креденшлы:

- ADC / service identity

Стоимость:

- `НЕТ ДАННЫХ`

Лимиты и квоты:

- per-topic quotas not recorded in repo
- `НЕТ ДАННЫХ`

Интеграция:

- device heartbeat
- alerts service
- sessions service
- future budget/cost flow

### 3.7 Cloud Tasks

Queues:

- `commands`
- `approvals`
- `exports`

Location:

- `europe-west1`

State:

- `RUNNING`

Queue rate limits at last known check:

- `maxBurstSize: 100`
- `maxConcurrentDispatches: 1000`
- `maxDispatchesPerSecond: 500.0`

Retry config:

- `maxAttempts: 100`
- `maxBackoff: 3600s`
- `maxDoublings: 16`
- `minBackoff: 0.100s`

Зачем используется:

- enqueue command delivery
- enqueue approval workflow
- enqueue export jobs

Файл:

- `apps/api/src/integrations/tasks.ts`

Известный blocker:

- `TASKS_TARGET_BASE_URL` не задан
- поэтому dispatch path честно остается `not_configured` / fallback-only

Стоимость:

- `НЕТ ДАННЫХ`

### 3.8 BigQuery

- Dataset: `ops_analytics`
- Location: `EU`
- Зачем используется: analytics/event sink
- Expected tables:
  - `cost_snapshots`
  - `alert_events`
  - `session_events`
  - `command_events`
- Файл:
  - `apps/api/src/integrations/bigquery.ts`
- Access state:
  - dataset exists
  - dataset-level write permission for runtime service account still not fully applied
- Стоимость:
  - `НЕТ ДАННЫХ`
- Лимиты и квоты:
  - `НЕТ ДАННЫХ`
- Интеграция:
  - `CommandsService`
  - `AlertsService`
  - `SessionsService`
  - future cost snapshot writes

### 3.9 Vertex AI

- Название: `Vertex AI`
- Зачем используется: all product-side LLM functionality
- Region: `europe-west4`
- Model default:
  - `gemini-2.5-flash`
- Файл:
  - `apps/api/src/providers/vertex-ai-provider.ts`
- Методы:
  - `generateText()`
  - `summarizeOperatorState()`
  - `explainAgentActivity()`
  - `suggestCostOptimizations()`
  - `planTaskBreakdown()`
- Auth:
  - ADC locally
  - Cloud Run service identity in cloud
- Стоимость:
  - actual spend `НЕТ ДАННЫХ`
- Лимиты и квоты:
  - `НЕТ ДАННЫХ`
- Интеграция:
  - AI API routes
  - readiness reporting
  - explicit error mapping for missing ADC / IAM / invalid config

### 3.10 Secret Manager

Secrets present:

- `github-token`
- `operator-jwt-secret`
- `session-signing-secret`

Replication:

- automatic

Зачем используется:

- backend runtime secrets

Файл:

- `apps/api/src/integrations/secrets.ts`

Methods:

- `readOperatorJwtSecret()`
- `readSessionSigningSecret()`
- `readGitHubToken()`

Креденшлы:

- ADC / service identity

Стоимость:

- `НЕТ ДАННЫХ`

### 3.11 Firebase / Identity Platform

- Firebase project attached to `operator-os-dev`
- Identity Platform enabled
- providers enabled:
  - email/password
  - Google

Зачем используется:

- operator authentication foundation

Server-side implementation:

- `firebase-admin`
- `apps/api/src/integrations/auth.ts`

Current state:

- backend token verification path exists
- mobile client login flow is not yet wired end-to-end

### 3.12 IAM / Service Accounts

Service accounts:

- `cloudrun-runtime`
- `deploy-bot`
- `analytics-writer`
- `notifier`

Documented applied roles:

- see `docs/IAM_PLAN.md`

Key applied rights:

- `cloudrun-runtime`:
  - `roles/aiplatform.user`
  - `roles/datastore.user`
  - queue/topic/secret/storage scoped permissions
- `deploy-bot`:
  - `roles/cloudbuild.builds.builder`
  - `roles/logging.logWriter`
  - `roles/run.admin`
  - repo/bucket/serviceAccountUser scoped deploy rights

Still manual:

- dataset-level `roles/bigquery.dataEditor` on `ops_analytics`

### 3.13 KMS

- key ring: `operator-os`
- key: `exports-key`
- location: `europe-west4`

Current runtime usage:

- explicit runtime usage in code: `НЕТ ДАННЫХ`
- provisioned resource exists and is documented, but no direct app integration in current code

### 3.14 Budget

- budget: `bootstrap-dev`

Runtime integration:

- no direct billing API integration implemented yet
- costs currently modeled through `costSnapshots` contract and BigQuery writer path

### 3.15 Cloud Functions, Cloud SQL, GKE, Redis

Current status:

- `Cloud Functions`: not used
- `Cloud SQL`: not used
- `GKE`: not used
- `Redis`: not used

---

## 4. АРХИТЕКТУРА

### Высокоуровневая архитектура

Текстовая схема:

1. `apps/mobile` запрашивает operator dashboard у API.
2. `apps/api` собирает состояние из Firestore, auth session, readiness и controlled fallback overlays.
3. `apps/desktop-agent` шлет heartbeat, poll-ит команды, сообщает о сессиях, export jobs и alert-ах.
4. API пишет/читает Firestore, публикует Pub/Sub events, enqueue-ит Cloud Tasks jobs, пишет аналитические события в BigQuery, кладет JSON artifacts в GCS и ходит в Vertex AI.
5. Cloud Run является основным runtime execution point, а Vertex AI — единственным AI backend.

### Микросервисы или монолит? Почему?

Текущая backend-модель:

- modular monolith

Почему:

- один backend service `operator-os-api`
- внутри него разделение на routes, integrations, services, modules
- отдельные runtime surfaces представлены мобильным приложением и desktop-agent, но control plane backend остается одним сервисом

Причины такой формы:

- проще bootstrap и Cloud Run deploy
- shared contracts проще использовать
- нет преждевременного разделения на большое количество сервисов

### Все сервисы/модули с их ответственностью

#### apps/api

- `src/app.ts`
  - composition root
  - собирает integrations, services, routes, ai provider
- `src/server.ts`
  - process startup / graceful shutdown
- `src/readiness.ts`
  - health/readiness aggregation

Routes:

- `src/routes/health.ts`
  - `/health`, `/ready`
- `src/routes/operator.ts`
  - operator-facing state endpoints
- `src/routes/agent.ts`
  - agent-facing mutation and polling endpoints
- `src/routes/ai.ts`
  - Vertex-backed AI endpoints

Integrations:

- `src/integrations/auth.ts`
  - `FirebaseAuthService`
- `src/integrations/firestore.ts`
  - `FirestoreOperatorRepository`
- `src/integrations/pubsub.ts`
  - `PubSubPublisher`
- `src/integrations/tasks.ts`
  - `TasksQueueClient`
- `src/integrations/storage.ts`
  - `GcsStorageService`
- `src/integrations/bigquery.ts`
  - `BigQueryAnalyticsWriter`
- `src/integrations/secrets.ts`
  - `SecretManagerAccessor`
- `src/integrations/runtime.ts`
  - ADC detection, readiness helpers, `IntegrationError`

Services:

- `src/services/commands.ts`
  - command intake, audit, storage, analytics, queueing, fallback memory delivery
- `src/services/sessions.ts`
  - session persistence, audit, Pub/Sub, BigQuery
- `src/services/alerts.ts`
  - alert persistence, audit, Pub/Sub, BigQuery
- `src/services/exports.ts`
  - export request recording, storage, queueing
- `src/services/service-utils.ts`
  - analytics event helpers

Providers:

- `src/providers/ai-provider.ts`
  - AI provider contract
- `src/providers/vertex-ai-provider.ts`
  - Vertex implementation

#### apps/mobile

- `App.tsx`
  - app bootstrap
- `src/navigation/root-tabs.tsx`
  - tab navigation
- `src/state/operator-store.ts`
  - dashboard state, transport mode, selected device, refresh logic
- `src/services/api-client.ts`
  - operator dashboard fetch, health fetch, controlled fallback
- `src/services/auth-session.ts`
  - auth session fetch wrapper
- `src/screens/*`
  - five user-facing screens

#### apps/desktop-agent

- `src/main.ts`
  - runtime entrypoint
- `src/runtime.ts`
  - `DesktopRuntime` composition root
- `src/api-client.ts`
  - HTTP calls to API
- `src/heartbeat-loop.ts`
  - periodic heartbeat
- `src/command-poller.ts`
  - command polling scheduler
- `src/session-manager.ts`
  - visible session stubs
- `src/export-manager.ts`
  - export job stubs
- `src/notifier.ts`
  - alert publishing wrapper
- `src/safe-command-executor.ts`
  - explicit non-destructive executor stub
- `src/device-state.ts`
  - device snapshot creation

### Паттерны взаимодействия между сервисами

- mobile → API: `REST / HTTP JSON`
- desktop-agent → API: `REST / HTTP JSON`
- API → Firestore: direct SDK calls
- API → Pub/Sub: typed event publish
- API → Cloud Tasks: job enqueue
- API → GCS: object write/read
- API → BigQuery: append inserts
- API → Vertex: generative model invocation

gRPC:

- не используется напрямую в коде приложения

Events:

- через Pub/Sub

Async jobs:

- через Cloud Tasks

### Аутентификация и авторизация

Authentication:

- server-side via Firebase Admin SDK
- token source: `Authorization: Bearer <Firebase ID token>`
- extraction in `extractBearerToken()` inside `apps/api/src/integrations/auth.ts`

Key methods:

- `verifyFirebaseIdToken(idToken)`
- `resolveSession(authorization, options)`
- `createOptionalGuard()`
- `createRequiredGuard()`

Authorization:

- полноценного RBAC enforcement по ролям пока нет
- есть shared auth claims model:
  - `packages/contracts/src/auth.ts`
  - roles: `owner`, `admin`, `viewer`, `agent`

Current auth posture:

- `/v1/auth/session`, `/v1/operator/state`, `/v1/operator/dashboard` используют optional guard
- жесткое ограничение privileged routes пока не реализовано полностью

### Безопасность

Прямо закреплено в `docs/SECURITY_MODEL.md`:

- no stealth
- no hidden control
- no spyware
- no keylogging
- no credential harvesting
- no hidden OS hooks
- no silent screen capture
- visible trusted sessions only

Runtime security primitives:

- Secret Manager for secrets
- service identities instead of static JSON keys
- Cloud Run requires authentication
- readiness/controlled fallback make system honesty part of trust model

### Масштабирование

Backend:

- horizontal-ish through Cloud Run instance scaling
- current `maxScale=3`

Firestore:

- managed service scaling

Pub/Sub / Tasks:

- managed async primitives

Desktop agents:

- conceptually scale by adding more devices/agents

Mobile:

- client-side scale is not a bottleneck at this stage

---

## 5. СТРУКТУРА ПРОЕКТА

### Полное дерево папок проекта

Ниже — рабочее дерево без `node_modules`, `.turbo`, `dist`.

```text
.
├─ .github/
│  ├─ PULL_REQUEST_TEMPLATE.md
│  └─ workflows/
│     └─ ci.yml
├─ apps/
│  ├─ api/
│  │  ├─ .env.example
│  │  ├─ Dockerfile
│  │  ├─ README.md
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ app.ts
│  │     ├─ app.test.ts
│  │     ├─ bootstrap-data.ts
│  │     ├─ index.ts
│  │     ├─ readiness.ts
│  │     ├─ server.ts
│  │     ├─ types.ts
│  │     ├─ integrations/
│  │     │  ├─ auth.ts
│  │     │  ├─ bigquery.ts
│  │     │  ├─ firestore.ts
│  │     │  ├─ pubsub.ts
│  │     │  ├─ runtime.ts
│  │     │  ├─ secrets.ts
│  │     │  ├─ storage.ts
│  │     │  └─ tasks.ts
│  │     ├─ modules/
│  │     │  ├─ index.ts
│  │     │  ├─ module-utils.ts
│  │     │  ├─ alerts/index.ts
│  │     │  ├─ analytics/index.ts
│  │     │  ├─ auth/index.ts
│  │     │  ├─ commands/index.ts
│  │     │  ├─ exports/index.ts
│  │     │  ├─ providers/index.ts
│  │     │  ├─ sessions/index.ts
│  │     │  ├─ storage/index.ts
│  │     │  ├─ telemetry/index.ts
│  │     │  └─ vertex/index.ts
│  │     ├─ providers/
│  │     │  ├─ ai-provider.ts
│  │     │  ├─ index.ts
│  │     │  └─ vertex-ai-provider.ts
│  │     ├─ routes/
│  │     │  ├─ agent.ts
│  │     │  ├─ ai.ts
│  │     │  ├─ health.ts
│  │     │  └─ operator.ts
│  │     └─ services/
│  │        ├─ alerts.ts
│  │        ├─ commands.ts
│  │        ├─ exports.ts
│  │        ├─ service-utils.ts
│  │        └─ sessions.ts
│  ├─ desktop-agent/
│  │  ├─ .env.example
│  │  ├─ README.md
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ api-client.ts
│  │     ├─ command-poller.ts
│  │     ├─ config.ts
│  │     ├─ device-state.ts
│  │     ├─ export-manager.ts
│  │     ├─ heartbeat-loop.ts
│  │     ├─ index.ts
│  │     ├─ logger.ts
│  │     ├─ main.ts
│  │     ├─ notifier.ts
│  │     ├─ runtime.test.ts
│  │     ├─ runtime.ts
│  │     ├─ safe-command-executor.ts
│  │     └─ session-manager.ts
│  └─ mobile/
│     ├─ App.tsx
│     ├─ README.md
│     ├─ app.json
│     ├─ babel.config.js
│     ├─ index.ts
│     ├─ metro.config.js
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ scripts/build-scaffold.mjs
│     └─ src/
│        ├─ components/
│        │  ├─ screen-shell.tsx
│        │  ├─ section-card.tsx
│        │  └─ status-pill.tsx
│        ├─ mocks/
│        │  └─ operator-data.ts
│        ├─ navigation/
│        │  └─ root-tabs.tsx
│        ├─ screens/
│        │  ├─ costs-screen.tsx
│        │  ├─ devices-screen.tsx
│        │  ├─ home-screen.tsx
│        │  ├─ sessions-screen.tsx
│        │  └─ settings-screen.tsx
│        ├─ services/
│        │  ├─ api-client.ts
│        │  └─ auth-session.ts
│        ├─ state/
│        │  ├─ operator-store.test.ts
│        │  └─ operator-store.ts
│        └─ theme/
│           ├─ navigation-theme.ts
│           └─ tokens.ts
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ BOOTSTRAP_STATUS.md
│  ├─ CLAUDE_CODE_EXPORT.md
│  ├─ DECISIONS.md
│  ├─ DEPLOY.md
│  ├─ GCP_RESOURCES.md
│  ├─ HANDOFF.md
│  ├─ IAM_PLAN.md
│  ├─ PASS2_STATUS.md
│  ├─ PASS3_STATUS.md
│  ├─ README.md
│  ├─ ROADMAP.md
│  ├─ SECURITY_MODEL.md
│  └─ VERTEX.md
├─ infra/
│  ├─ cloud-run/
│  │  └─ api.service.yaml
│  ├─ cloudbuild/
│  │  └─ api.cloudbuild.yaml
│  └─ scripts/
│     ├─ deploy-api.ps1
│     ├─ iam-bindings.ps1
│     ├─ iam-bindings.sh
│     ├─ verify-api.ps1
│     └─ verify-workspace.ps1
├─ packages/
│  ├─ config/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ api.ts
│  │     ├─ desktop-agent.ts
│  │     ├─ helpers.ts
│  │     ├─ index.test.ts
│  │     ├─ index.ts
│  │     └─ mobile.ts
│  ├─ contracts/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ auth.ts
│  │     ├─ common.ts
│  │     ├─ health.ts
│  │     ├─ index.test.ts
│  │     ├─ index.ts
│  │     ├─ messaging.ts
│  │     ├─ operator.ts
│  │     └─ runtime.ts
│  └─ tooling/
│     ├─ package.json
│     └─ scripts/
│        └─ placeholder-task.mjs
├─ .editorconfig
├─ .env.example
├─ .gitignore
├─ .prettierrc.json
├─ eslint.config.mjs
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ README.md
├─ tsconfig.base.json
└─ turbo.json
```

### Описание каждой ключевой папки

- `apps/api`: Fastify control plane API
- `apps/mobile`: Expo mobile operator app
- `apps/desktop-agent`: transparent desktop runtime scaffold
- `packages/contracts`: shared Zod contracts
- `packages/config`: shared env validation/parsing
- `packages/tooling`: minimal tooling placeholder
- `docs`: source-of-truth documentation
- `infra`: deploy, IAM, Cloud Build, Cloud Run files
- `.github`: CI + PR hygiene

### Важные файлы конфигурации и что в них

- `package.json`
  - root scripts, workspace dev dependencies
- `pnpm-workspace.yaml`
  - workspace package globs
- `turbo.json`
  - task pipeline for build/lint/test/typecheck/dev
- `tsconfig.base.json`
  - shared TypeScript base config
- `eslint.config.mjs`
  - ESLint rules
- `.prettierrc.json`
  - formatting rules
- `.editorconfig`
  - editor defaults
- `.env.example`
  - top-level shared dev env example
- `apps/api/.env.example`
  - API env example
- `apps/desktop-agent/.env.example`
  - desktop-agent env example
- `apps/api/Dockerfile`
  - multistage API image build
- `infra/cloudbuild/api.cloudbuild.yaml`
  - remote build/deploy config
- `infra/cloud-run/api.service.yaml`
  - service manifest

### Environment variables

#### Root / shared

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_REGION`
- `FIREBASE_PROJECT_ID`
- `VERTEX_LOCATION`
- `VERTEX_MODEL`
- `BIGQUERY_DATASET`
- `CLOUD_TASKS_LOCATION`
- `HOST`
- `PORT`
- `LOG_LEVEL`
- `API_SERVICE_NAME`
- `READINESS_STRICT`
- `TASKS_TARGET_BASE_URL`
- `AGENT_ID`
- `DEVICE_ID`
- `DEVICE_NAME`
- `DEVICE_PLATFORM`
- `API_BASE_URL`
- `API_REQUEST_TIMEOUT_MS`
- `HEARTBEAT_INTERVAL_MS`
- `COMMAND_POLL_INTERVAL_MS`
- `SESSION_POLL_INTERVAL_MS`
- `ENABLE_COMMAND_EXECUTION`
- `CONTROLLED_FALLBACK`
- `EXPO_PUBLIC_APP_ENV`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_USE_MOCKS`
- `EXPO_PUBLIC_API_TIMEOUT_MS`
- `EXPO_PUBLIC_CONTROLLED_FALLBACK`
- `EXPO_PUBLIC_AUTH_MODE`

#### API-specific

- `NODE_ENV`
- `FIRESTORE_DATABASE`
- `FIRESTORE_DEVICE_STATES_COLLECTION`
- `FIRESTORE_OPERATOR_STATES_COLLECTION`
- `FIRESTORE_SESSIONS_COLLECTION`
- `FIRESTORE_ALERTS_COLLECTION`
- `FIRESTORE_COST_SNAPSHOTS_COLLECTION`
- `FIRESTORE_AUDIT_EVENTS_COLLECTION`
- `COMMANDS_QUEUE`
- `APPROVALS_QUEUE`
- `EXPORTS_QUEUE`
- `AGENT_EVENTS_TOPIC`
- `BUDGET_EVENTS_TOPIC`
- `OPERATOR_ALERTS_TOPIC`
- `SESSION_EVENTS_TOPIC`
- `ARTIFACTS_BUCKET`
- `EXPORTS_BUCKET`
- `REMOTE_BUCKET`
- `ARTIFACT_REGISTRY_REPOSITORY`
- `CLOUD_RUN_SERVICE_NAME`
- `CLOUD_RUN_SERVICE_ACCOUNT`
- `OPERATOR_JWT_SECRET_NAME`
- `SESSION_SIGNING_SECRET_NAME`
- `GITHUB_TOKEN_SECRET_NAME`

#### Desktop-agent-specific

- `EXPORTS_BUCKET`
- `REMOTE_BUCKET`
- `NOTIFIER_TOPIC`

### Конвенции именования файлов и папок

Наблюдаемые конвенции:

- package names:
  - `@operator-os/api`
  - `@operator-os/mobile`
  - `@operator-os/desktop-agent`
  - `@operator-os/contracts`
  - `@operator-os/config`
- source files: kebab-case or descriptive lower-case filenames
- screens:
  - `home-screen.tsx`
  - `devices-screen.tsx`
- service/integration classes: PascalCase inside lower-case file
- contracts grouped by domain:
  - `auth.ts`, `health.ts`, `operator.ts`, `messaging.ts`, `runtime.ts`

### Где лежат миграции, тесты, документация

Миграции:

- Firestore migrations: отсутствуют
- BigQuery migrations: отсутствуют
- SQL migrations: отсутствуют

Тесты:

- `apps/api/src/app.test.ts`
- `apps/desktop-agent/src/runtime.test.ts`
- `apps/mobile/src/state/operator-store.test.ts`
- `packages/config/src/index.test.ts`
- `packages/contracts/src/index.test.ts`

Документация:

- `README.md`
- `docs/*`

---

## 6. КЛЮЧЕВЫЕ ФИЧИ

### 6.1 Operator dashboard

- Название: Operator Dashboard
- Описание для пользователя:
  - единая сводка по devices, sessions, alerts, costs, health, readiness и auth state
- Техническая реализация:
  - endpoint `/v1/operator/dashboard`
  - schema `operatorDashboardSchema`
  - источник данных: `FirestoreOperatorRepository.getOperatorState()`
  - controlled fallback через `buildBootstrapOperatorState()`
- Файлы:
  - `apps/api/src/routes/operator.ts`
  - `apps/api/src/integrations/firestore.ts`
  - `apps/api/src/bootstrap-data.ts`
  - `packages/contracts/src/runtime.ts`
  - `apps/mobile/src/state/operator-store.ts`
- Внешние API:
  - Firestore
  - Firebase Admin auth session resolution
- Статус:
  - частично готово, live-ready, но всё ещё может возвращать fallback state

### 6.2 Health / readiness model

- Название: Health and Readiness
- Описание:
  - показывает, жив ли процесс и какие зависимости реально готовы
- Техническая реализация:
  - `/health` always process alive
  - `/ready` aggregates module readiness and returns `503`, если status degraded
- Файлы:
  - `apps/api/src/routes/health.ts`
  - `apps/api/src/readiness.ts`
- Внешние API:
  - none directly, but depends on readiness of all GCP integrations
- Статус:
  - готово

### 6.3 Firebase auth session resolution

- Название: Firebase-backed auth session
- Описание:
  - API умеет определить operator session по Firebase ID token
- Реализация:
  - Firebase Admin initialization via ADC
  - optional and required guards
  - typed auth session contract
- Файлы:
  - `apps/api/src/integrations/auth.ts`
  - `packages/contracts/src/auth.ts`
- Внешние API:
  - Firebase Admin / Identity Platform
- Статус:
  - backend foundation готова; client-side auth flow не завершен

### 6.4 Agent heartbeat

- Название: Desktop heartbeat
- Описание:
  - desktop agent отправляет состояние устройства в API
- Реализация:
  - `HeartbeatLoop` periodically calls `postHeartbeat()`
  - API persists device state and publishes agent event
- Файлы:
  - `apps/desktop-agent/src/heartbeat-loop.ts`
  - `apps/desktop-agent/src/api-client.ts`
  - `apps/api/src/routes/agent.ts`
  - `apps/api/src/integrations/firestore.ts`
  - `apps/api/src/integrations/pubsub.ts`
- Внешние API:
  - Firestore
  - Pub/Sub
- Статус:
  - live-ready and wired

### 6.5 Command intake and polling

- Название: Command pipeline
- Описание:
  - API принимает команды, а desktop agent poll-ит их
- Реализация:
  - `CommandsService.dispatchCommand()`
  - in-memory pending queue fallback
  - Cloud Tasks enqueue abstraction
  - command poll endpoint
- Файлы:
  - `apps/api/src/services/commands.ts`
  - `apps/api/src/routes/agent.ts`
  - `apps/desktop-agent/src/command-poller.ts`
  - `apps/desktop-agent/src/safe-command-executor.ts`
- Внешние API:
  - Cloud Tasks
  - Firestore audit
  - Storage
  - BigQuery
- Статус:
  - частично готово; durable worker path not complete

### 6.6 Visible session lifecycle

- Название: Trusted visible sessions
- Описание:
  - создаются и обновляются только видимые trusted/observe-only sessions
- Реализация:
  - `SessionManager.openVisibleSession()`
  - `SessionManager.closeVisibleSession()`
  - API `SessionsService.recordSession()`
- Файлы:
  - `apps/desktop-agent/src/session-manager.ts`
  - `apps/api/src/services/sessions.ts`
  - `packages/contracts/src/operator.ts`
- Внешние API:
  - Firestore
  - Pub/Sub
  - BigQuery
- Статус:
  - foundation ready, real remote session implementation absent

### 6.7 Alerts

- Название: Alert pipeline
- Описание:
  - агент и API могут создавать alert-ы, которые попадают в state, analytics и fan-out
- Реализация:
  - `AlertsService.emitAlert()`
  - desktop notifier wrapper
- Файлы:
  - `apps/api/src/services/alerts.ts`
  - `apps/desktop-agent/src/notifier.ts`
  - `packages/contracts/src/operator.ts`
- Внешние API:
  - Firestore
  - Pub/Sub
  - BigQuery
- Статус:
  - live-ready

### 6.8 Exports

- Название: Export jobs
- Описание:
  - система принимает export requests и готовит dispatch path
- Реализация:
  - `ExportsService.queueExport()`
  - export JSON uploads to GCS
  - queue entry to Cloud Tasks
- Файлы:
  - `apps/api/src/services/exports.ts`
  - `apps/desktop-agent/src/export-manager.ts`
- Внешние API:
  - GCS
  - Cloud Tasks
  - Firestore audit
- Статус:
  - partial / live-ready, worker dispatch not complete

### 6.9 Vertex explainability

- Название: AI explainability routes
- Описание:
  - summarize / explain / optimize / plan endpoints
- Реализация:
  - `VertexAIProvider`
  - ADC detection + explicit integration errors
- Файлы:
  - `apps/api/src/providers/vertex-ai-provider.ts`
  - `apps/api/src/routes/ai.ts`
- Внешние API:
  - Vertex AI Gemini
- Статус:
  - live-ready foundation; full smoke validation still pending

### 6.10 Controlled fallback

- Название: Controlled fallback mode
- Описание:
  - если dependency не готова, система не врет, а возвращает typed fallback с reason
- Реализация:
  - `buildBootstrapOperatorState()`
  - readiness checks
  - mobile local fallback
  - desktop-agent fallback receipts
- Файлы:
  - `apps/api/src/bootstrap-data.ts`
  - `apps/api/src/readiness.ts`
  - `apps/mobile/src/services/api-client.ts`
  - `apps/desktop-agent/src/api-client.ts`
- Внешние API:
  - none; this is a product behavior pattern
- Статус:
  - готово и является ключевым design rule

---

## 7. API ENDPOINTS

### Public / operator-facing endpoints

| Method | URL | Назначение | Параметры | Ответ | Auth | Rate limits |
|---|---|---|---|---|---|---|
| GET | `/health` | Process liveness | none | `HealthResponse` | нет | `НЕТ ДАННЫХ` |
| GET | `/ready` | Dependency readiness | none | `HealthResponse`, status may be 503 | нет | `НЕТ ДАННЫХ` |
| GET | `/v1/auth/session` | Current auth session | bearer token optional | `AuthSession` | optional | `НЕТ ДАННЫХ` |
| GET | `/v1/operator/state` | Aggregated operator state | bearer token optional | `OperatorState` | optional | `НЕТ ДАННЫХ` |
| GET | `/v1/operator/dashboard` | Dashboard bundle | bearer token optional | `OperatorDashboard` | optional | `НЕТ ДАННЫХ` |
| GET | `/v1/devices` | Devices list | none | `DeviceState[]` | нет | `НЕТ ДАННЫХ` |
| GET | `/v1/sessions` | Sessions list | none | `Session[]` | нет | `НЕТ ДАННЫХ` |
| GET | `/v1/alerts` | Alerts list | none | `Alert[]` | нет | `НЕТ ДАННЫХ` |
| GET | `/v1/costs` | Cost snapshots | none | `CostSnapshot[]` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/commands` | Intake command | body=`Command` | `MutationReceipt` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/sessions` | Upsert session | body=`Session` | `SessionReceipt` | нет | `НЕТ ДАННЫХ` |

### Agent-facing endpoints

| Method | URL | Назначение | Параметры | Ответ | Auth | Rate limits |
|---|---|---|---|---|---|---|
| POST | `/v1/agent/heartbeat` | Record device state | body=`DeviceState` | `MutationReceipt` | нет | `НЕТ ДАННЫХ` |
| GET | `/v1/agent/commands` | Poll commands | query=`deviceId` | `CommandPollResponse` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/agent/sessions` | Record session from agent | body=`Session` | `SessionReceipt` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/agent/exports` | Queue export from agent | body=`ExportJob` | `ExportReceipt` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/agent/alerts` | Emit alert from agent | body=`Alert` | `MutationReceipt` | нет | `НЕТ ДАННЫХ` |

### AI endpoints

| Method | URL | Назначение | Body | Ответ | Auth | Rate limits |
|---|---|---|---|---|---|---|
| POST | `/v1/ai/summarize/operator-state` | Summarize operator state | arbitrary JSON | `GenerateTextResult` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/ai/explain/agent-activity` | Explain agent activity | arbitrary JSON | `GenerateTextResult` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/ai/suggest-cost-optimizations` | Suggest optimizations | arbitrary JSON | `GenerateTextResult` | нет | `НЕТ ДАННЫХ` |
| POST | `/v1/ai/plan-task-breakdown` | Plan task breakdown | arbitrary JSON | `GenerateTextResult` | нет | `НЕТ ДАННЫХ` |

### Body / response contracts

Main schemas:

- `packages/contracts/src/auth.ts`
- `packages/contracts/src/health.ts`
- `packages/contracts/src/operator.ts`
- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/messaging.ts`

### Hidden/internal endpoints

Cloud Tasks client references these target paths:

- `/internal/tasks/commands`
- `/internal/tasks/approvals`
- `/internal/tasks/exports`

Current status:

- referenced in code
- not implemented as Fastify routes in current API
- therefore queue dispatch is not yet end-to-end live

---

## 8. БАЗА ДАННЫХ

### 8.1 Firestore schema

Это не SQL schema, а collection/document model.

#### `deviceStates`

- doc id: `deviceId`
- contract: `DeviceState`
- fields:
  - `deviceId: string`
  - `displayName: string`
  - `platform: 'windows' | 'macos' | 'linux'`
  - `runtimeStatus: 'offline' | 'starting' | 'ready' | 'busy' | 'error'`
  - `agentVersion: string`
  - `lastHeartbeatAt?: ISO datetime`
  - `activeSessionId?: string`
  - `capabilities: string[]`
  - `metadata: record`

#### `operatorStates`

- likely doc id: `latest` for snapshot path
- contract: `OperatorState`
- fields:
  - `devices: DeviceState[]`
  - `sessions: Session[]`
  - `alerts: Alert[]`
  - `costs: CostSnapshot[]`
  - `generatedAt: ISO datetime`
  - `dataSource: 'live' | 'bootstrap-fallback' | 'api-controlled-fallback'`
  - `fallbackReason?: string`

#### `sessions`

- doc id: `session.id`
- contract: `Session`
- fields:
  - `id`
  - `deviceId`
  - `operatorId`
  - `status`
  - `mode`
  - `visibility='visible'`
  - `approvalId?`
  - `startedAt?`
  - `endedAt?`
  - `createdAt`
  - `updatedAt?`

#### `alerts`

- doc id: `alert.id`
- contract: `Alert`

#### `costSnapshots`

- doc id: `snapshot.id`
- contract: `CostSnapshot`

#### `auditEvents`

- doc id: `analyticsEvent.id`
- contract: `AnalyticsEvent`

### 8.2 BigQuery schema

Expected tables and shapes:

#### `cost_snapshots`

- source contract: `CostSnapshot`
- extra field:
  - `ingestedAt`

#### `alert_events`

- source contract: `Alert`
- extra field:
  - `ingestedAt`

#### `session_events`

- source contract: `Session`
- extra field:
  - `ingestedAt`

#### `command_events`

- source contract: `Command`
- extra field:
  - `ingestedAt`

### Поля, типы, ограничения, индексы

Firestore:

- strictness enforced in application layer via Zod
- DB-level indexes/composite indexes:
  - `НЕТ ДАННЫХ`
- constraints:
  - doc IDs chosen by service layer

BigQuery:

- no checked-in schema DDL files
- table creation behavior not explicitly implemented in repo

### Связи между сущностями

Связи логические, а не FK:

- `Session.deviceId -> DeviceState.deviceId`
- `Session.operatorId -> logical operator identity`
- `Alert.deviceId -> DeviceState.deviceId`
- `Alert.sessionId -> Session.id`
- `Command.deviceId -> DeviceState.deviceId`
- `Command.sessionId -> Session.id`
- `ExportJob.deviceId -> DeviceState.deviceId`
- `ExportJob.sessionId -> Session.id`
- `CostSnapshot.scopeId` can refer to project/service/device/session depending on scope

### Ключевые запросы

Главный read path:

- `FirestoreOperatorRepository.getOperatorState()`
  - reads:
    - `deviceStates`
    - `sessions`
    - `alerts`
    - `costSnapshots`
  - merges live docs with transient in-memory overlay

Главные write paths:

- `recordDeviceState()`
- `recordSession()`
- `recordAlert()`
- `recordCostSnapshot()`
- `appendAuditEvent()`
- `saveOperatorStateSnapshot()`

Analytics writes:

- `writeCostSnapshot()`
- `writeAlertEvent()`
- `writeSessionEvent()`
- `writeCommandEvent()`

### Стратегия бэкапов

Подтвержденная стратегия application-level backups:

- `НЕТ ДАННЫХ`

Известные managed hints:

- Firestore PITR disabled
- Firestore retention `3600s`
- GCS soft delete `604800s`

### Миграции

- SQL migrations: отсутствуют
- Firestore migration framework: отсутствует
- BigQuery migration framework: отсутствует

---

## 9. DEPLOYMENT

### Как деплоится проект пошагово

#### Local validation

1. `pnpm install`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`

#### Local runtime

1. API:
   - `pnpm --filter @operator-os/api dev`
2. Desktop agent:
   - `pnpm --filter @operator-os/desktop-agent dev`
3. Mobile:
   - `pnpm --filter @operator-os/mobile dev`

#### Local Docker build target

Command:

```powershell
docker build -f apps/api/Dockerfile -t operator-os-api:local .
```

Current truthful state:

- not confirmed locally because Docker Desktop / WSL is broken on the original workstation path

#### Remote Cloud Build + deploy path

Command:

```powershell
.\infra\scripts\deploy-api.ps1 -ImageTag pass3 -UseCloudBuild -Deploy
```

Under the hood:

1. submits source to Cloud Build
2. builds API image
3. pushes image to Artifact Registry
4. optionally deploys to Cloud Run

#### Verify deployed service

Command:

```powershell
.\infra\scripts\verify-api.ps1
```

### Какие окружения есть

Фактически оформлены:

- local development
- deployed Cloud Run target

Formal separate environments:

- `dev`: partially represented
- `staging`: `НЕТ ДАННЫХ`
- `prod`: `НЕТ ДАННЫХ`

То есть env-matrix как полноценная dev/staging/prod система ещё не оформлена.

### Переменные окружения для каждого

Local API:

- see `apps/api/.env.example`

Local desktop-agent:

- see `apps/desktop-agent/.env.example`

Local mobile:

- see root `.env.example`

Cloud Run deployed env at last known state:

- `NODE_ENV=production`
- `GOOGLE_CLOUD_PROJECT=operator-os-dev`
- `GOOGLE_CLOUD_REGION=europe-west4`
- `FIREBASE_PROJECT_ID=operator-os-dev`
- `VERTEX_LOCATION=europe-west4`
- `VERTEX_MODEL=gemini-2.5-flash`
- `BIGQUERY_DATASET=ops_analytics`
- `CLOUD_TASKS_LOCATION=europe-west1`
- `TASKS_TARGET_BASE_URL` blank / unset

### Домены и SSL

Current domain:

- Cloud Run default domain only
- `https://operator-os-api-m545sz2isq-ez.a.run.app`

SSL:

- managed by Cloud Run

Custom domain:

- `НЕТ ДАННЫХ`

### CDN

- not used

### Процесс релизов

Наблюдаемый процесс:

- work in feature/phase branches
- CI on pushes/PRs
- manual Cloud Build deploy path
- no evidence of tagged release process
- no evidence of semantic release or changelog automation

---

## 10. ТЕКУЩИЕ ПРОБЛЕМЫ И TECH DEBT

### Известные баги / blockers

- local Docker daemon was blocked by WSL state on original workstation
- local Docker build not truthfully confirmed
- `TASKS_TARGET_BASE_URL` unset, so `/ready` is degraded
- durable Cloud Tasks worker endpoints are referenced but not implemented
- BigQuery dataset-level write IAM still manual
- live Vertex inference smoke test not yet recorded as complete in docs
- Firestore/PubSub/Tasks/Storage/Secrets live smoke tests still incomplete as an end-to-end matrix

### Технический долг

- command delivery remains in in-memory API fallback queue
- exports dispatch remains fallback-only until task targets exist
- operator-facing read endpoints are not yet fully auth-enforced
- mobile auth is still bootstrap-fallback aware rather than end-to-end Firebase login
- desktop-agent intentionally does not execute real OS actions
- no background worker service yet
- no formal DB/table provisioning workflow for BigQuery

### Места, которые планировали отрефакторить

Явно из структуры видно:

- readiness/deploy docs need sync with latest pass state
- `docs/ARCHITECTURE.md` and `docs/VERTEX.md` still mention older constraints in places
- CI workflow currently triggers on `phase2/**` but not `phase3/**`

### Производственные проблемы

Подтвержденные performance issues:

- `НЕТ ДАННЫХ`

Potential future issues:

- `getOperatorState()` does full collection reads for four collections
- no pagination
- no caching
- BigQuery writes assume tables exist

### Security concerns

- AI endpoints currently do not require auth
- several operator read endpoints are not required-auth protected
- temporary verification-only `run.invoker` permissions were granted to user/deploy-bot
- no rate limiting / abuse protection layer yet
- no explicit audit retention policy yet

---

## 11. БИЗНЕС-ЛОГИКА

### Все бизнес-правила приложения

- project must remain a visible trusted operator system
- no stealth / spyware / hidden control
- all sessions must be explicit and `visibility='visible'`
- command approval is default-safe:
  - `approvalRequired` defaults to `true`
- if command is pending and `approvalRequired=false`, API upgrades it to `approved` before queueing
- health and readiness must be honest, not optimistic
- if dependency is unavailable, system may use controlled fallback but must say so
- desktop-agent must not run hidden or destructive OS actions

### Edge cases, которые учитываются

- missing ADC
- missing IAM permissions
- invalid Vertex region/model/project config
- empty Firestore collections
- Firestore read failure
- Firestore write failure
- Pub/Sub publish failure
- Cloud Tasks enqueue failure
- Storage upload failure
- BigQuery insert failure
- missing Firebase token
- invalid Firebase token
- mobile API unavailable
- desktop-agent API unavailable
- blank `TASKS_TARGET_BASE_URL`
- Vertex returns no candidate text

### Расчёты, формулы, алгоритмы

Сложной доменной математики пока нет.

Текущее вычислительное поведение:

- readiness status:
  - `degraded`, если есть degraded checks
  - также `degraded`, если `READINESS_STRICT=true` и есть `not_configured`
- mobile collection screen status:
  - `error` if errorMessage exists
  - `empty` if list length is zero
  - `ready` otherwise
- bootstrap/live merging:
  - merge by key for devices, sessions, alerts, costs
- analytics rows:
  - append `ingestedAt`

### Процессы

#### Регистрация / login

- полноценный mobile client auth flow: не реализован
- server-side verification path exists for Firebase ID tokens

#### Command dispatch

1. API receives `Command`
2. validates with Zod
3. writes audit event
4. uploads command JSON artifact
5. writes BigQuery command event
6. if approval required:
   - enqueue approval
7. else:
   - push into in-memory pending queue
   - try enqueue command into Cloud Tasks

#### Session lifecycle

1. desktop-agent creates visible session stub
2. API persists it
3. API appends audit event
4. API publishes session event
5. API writes BigQuery session event

#### Export flow

1. export request created
2. JSON request stored in exports bucket
3. audit event appended
4. Cloud Tasks export enqueue attempted

---

## 12. ИНТЕГРАЦИИ С ТРЕТЬИМИ СТОРОНАМИ

### Firebase Admin / Identity Platform

- Зачем:
  - verify operator identity via Firebase ID tokens
- Как настроена:
  - server-side ADC initialization
  - projectId = `operator-os-dev`
- Какие данные передаются:
  - bearer Firebase ID token
  - decoded claims -> `VerifiedUserContext`
- Обработка ошибок:
  - invalid token => unauthenticated session or 401 in strict mode
  - missing ADC => `IntegrationError(missing_adc)`

### Vertex AI / Gemini

- Зачем:
  - explainability and operator intelligence
- Как настроена:
  - `VertexAIProvider`
  - project/location/model from env
- Какие данные передаются:
  - JSON prompt payloads serialized into text prompt
- Обработка ошибок:
  - mapped to `missing_adc`, `missing_iam`, `invalid_config`, `upstream_error`

### Firestore

- Зачем:
  - control-plane state storage
- Как настроена:
  - Firestore client via ADC
  - database `(default)`
- Какие данные:
  - device, session, alert, cost, audit docs
- Ошибки:
  - read/write failure => controlled fallback / warn logs

### Pub/Sub

- Зачем:
  - event fan-out
- Как настроена:
  - typed topic publishers
- Какие данные:
  - device, session, alert, cost snapshot messages
- Ошибки:
  - publish failure => `record-only` mode

### Cloud Tasks

- Зачем:
  - job dispatch for commands/approvals/exports
- Как настроена:
  - queue path from env
  - target URL built from `TASKS_TARGET_BASE_URL`
- Какие данные:
  - typed JSON payloads
- Ошибки:
  - missing URL or failure => `record-only`

### Cloud Storage

- Зачем:
  - command/export artifact JSON storage
- Как настроена:
  - bucket aliases `artifacts`, `exports`, `remote`
- Какие данные:
  - JSON payload files
- Ошибки:
  - upload failure => `record-only`

### Secret Manager

- Зачем:
  - access runtime secrets
- Как настроена:
  - `readLatestVersion` from project secrets
- Какие данные:
  - operator/session signing secrets
  - optional GitHub token
- Ошибки:
  - integration error via mapped GCP error

### BigQuery

- Зачем:
  - analytics/event sink
- Как настроена:
  - dataset `ops_analytics`
- Какие данные:
  - append event rows
- Ошибки:
  - insert failure => returns false and logs warning

### GitHub

- Зачем:
  - source control and CI
- Как настроена:
  - remote repo
  - GitHub Actions workflow
- Какие данные:
  - source code, PR metadata, CI runs
- Ошибки:
  - workflow/push auth issues were handled in previous passes

### Неиспользуемые интеграции

- платежки: `НЕТ ДАННЫХ / не используются`
- SMS: `НЕТ ДАННЫХ / не используются`
- email provider: `НЕТ ДАННЫХ / не используются`
- external product analytics SaaS: `НЕТ ДАННЫХ / не используются`

---

## 13. ТЕСТИРОВАНИЕ

### Unit-тесты

Framework:

- `vitest`

Test files:

- `apps/api/src/app.test.ts`
- `apps/desktop-agent/src/runtime.test.ts`
- `apps/mobile/src/state/operator-store.test.ts`
- `packages/config/src/index.test.ts`
- `packages/contracts/src/index.test.ts`

Coverage:

- formal coverage report: `НЕТ ДАННЫХ`

### Integration тесты

Есть минимальные integration-like tests:

- Fastify `app.inject()` tests for API routes

### E2E тесты

- `НЕТ ДАННЫХ`
- полноценных E2E mobile/backend/desktop flows в repo нет

### CI/CD пайплайн

GitHub Actions workflow:

- install
- lint
- typecheck
- test
- build
- docker build for API image

Cloud Build:

- image build
- image push
- optional deploy

### Что реально подтверждено

Из docs:

- `pnpm lint` passed
- `pnpm typecheck` passed
- `pnpm test` passed
- `pnpm build` passed
- deployed `/health` verified
- deployed `/ready` verified as honest degraded

---

## 14. ИСТОРИЯ ПРОЕКТА

### Ключевые решения

Подтвержденные решения:

- monorepo with `pnpm` + `turbo`
- TypeScript across runtime surfaces
- Fastify backend
- Expo mobile
- Vertex only
- Cloud Run first
- no hidden remote control
- no Prisma/Postgres at bootstrap stage

### Эволюция архитектуры

Phase 1:

- bootstrap monorepo
- docs-first
- basic scaffolds for API/mobile/desktop-agent

Phase 2:

- live-ready integration foundation
- GCP-aware abstractions
- mobile and desktop moved from pure mock skeleton to live-ready interfaces

Phase 3:

- first honest Cloud Run deploy
- ADC and IAM recovery
- deployment path repair
- service now exists and is reachable with auth

### Что пробовали и отказались

Отказались по docs/requirements:

- GKE
- NestJS
- Prisma/Postgres in bootstrap
- OpenAI runtime inside product
- stealth behaviors

### Пивоты

- подтвержденных product pivots в repo: `НЕТ ДАННЫХ`

---

## 15. ROADMAP

### Ближайший спринт

На основе `docs/ROADMAP.md` + `docs/PASS3_STATUS.md`:

- fix local WSL / Docker and confirm local API image build
- set `TASKS_TARGET_BASE_URL`
- redeploy API
- re-run `/ready`
- execute live smoke tests for:
  - Secret Manager
  - Firestore
  - Pub/Sub
  - Cloud Tasks
  - Storage
  - BigQuery
  - Vertex
- update mobile to consume live backend state more aggressively

### Следующие 3 месяца

- durable workers for commands/approvals/exports
- Firebase client auth flow in mobile
- stronger authorization on privileged endpoints
- live cost snapshot ingestion
- BigQuery schema and validation completion
- CI/CD tightening, potentially repo-triggered Cloud Build

### Следующие 6-12 месяцев

- trusted remote session implementation
- richer approval flows
- mobile release pipeline
- audit trail hardening
- multi-device operator workflows
- stronger observability and monitoring

### Идеи на будущее

`ИНФЕРЕНС`:

- per-device policy engine
- operator suggestions driven by historical BigQuery data
- cost anomaly detection
- exported audit bundles encrypted with KMS
- richer explainability UI in mobile

---

## 16. ЛЮДИ И ПРОЦЕССЫ

### Команда

Подтвержденных данных о составе команды в repo нет.

- `НЕТ ДАННЫХ`

Минимально предполагаемые роли для продолжения проекта:

- product owner / operator
- full-stack platform engineer
- mobile engineer
- infra / cloud engineer
- security reviewer

### Как принимаем решения

Фактически по repo:

- docs are source of truth
- архитектурные решения фиксируются в `docs/DECISIONS.md`
- статус проходов фиксируется в `docs/PASS2_STATUS.md` и `docs/PASS3_STATUS.md`

### Как работаем с задачами

- Jira/Trello/Linear: `НЕТ ДАННЫХ`
- task flow фактически отражен через docs `ROADMAP`, `HANDOFF`, `PASS*`

### Code review процесс

Есть:

- `.github/PULL_REQUEST_TEMPLATE.md`
- CI workflow on PRs

Не подтверждено:

- branch protection rules
- mandatory approvals
- CODEOWNERS

### Git workflow

Подтвержденная дисциплина из предыдущих passes:

- `main` не использовать для substantive work
- ветки вида:
  - `bootstrap/...`
  - `phase2/...`
  - `phase3/...`
  - `feature/...`
  - `chore/...`
- не использовать `codex/*`, `ai/*`, `gpt/*`
- коммиты в стиле conventional-ish:
  - `chore(repo): ...`
  - `feat(runtime): ...`
  - `feat(deploy): ...`

Известные важные коммиты:

- `464af02 chore(repo): initialize empty project scaffold`
- `26a6526 chore(repo): initialize monorepo foundation`
- `8def281 feat(bootstrap): add app scaffolds and delivery foundation`
- `35db2db feat(runtime): add live-ready integration foundation`
- `2f2d5f7 feat(deploy): validate first live cloud run path`

---

## 17. КЛЮЧЕВЫЕ КОМАНДЫ

### Запуск проекта локально

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @operator-os/api dev
pnpm --filter @operator-os/desktop-agent dev
pnpm --filter @operator-os/mobile dev
```

### Запуск тестов

```powershell
pnpm test
pnpm --filter @operator-os/api test
pnpm --filter @operator-os/desktop-agent test
pnpm --filter @operator-os/mobile test
pnpm --filter @operator-os/contracts test
pnpm --filter @operator-os/config test
```

### Деплой

```powershell
.\infra\scripts\deploy-api.ps1 -ImageTag pass3 -UseCloudBuild -Deploy
.\infra\scripts\verify-api.ps1
```

### Docker

```powershell
docker build -f apps/api/Dockerfile -t operator-os-api:local .
docker version
docker info
```

### GCP auth / ADC

```powershell
gcloud auth login
gcloud config set project operator-os-dev
gcloud auth application-default login
gcloud auth application-default print-access-token
```

### IAM / infra helpers

```powershell
.\infra\scripts\iam-bindings.ps1
```

### Миграции БД

- отсутствуют

### Очистка кэша

- отдельного application cache слоя нет
- специальных project cache clear команд нет

### Логи

Repository-provided:

```powershell
.\infra\scripts\verify-api.ps1
```

Operationally useful GCP commands:

```powershell
gcloud run services describe operator-os-api --region=europe-west4 --project=operator-os-dev
gcloud builds describe 44dd3fac-6f49-47f7-a04b-95e663a5f048 --project=operator-os-dev
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=operator-os-api" --limit=50 --project=operator-os-dev
```

---

## 18. ВСЁ ОСТАЛЬНОЕ

### Странные решения и почему они приняты

- controlled fallback реализован везде и считается feature, а не defect
- desktop-agent deliberately does not execute real commands even if polling works
- queue delivery partially lives in API memory until worker path is completed
- AI routes already exposed even though full live smoke validation is incomplete

### Подводные камни

- отсутствие `TASKS_TARGET_BASE_URL` делает `/ready` degraded by design
- local Docker truth still depends on WSL repair on original machine
- BigQuery write path may silently remain not-live until IAM and tables are fully correct
- some docs are slightly older than latest pass status
- current CI workflow does not list `phase3/**` in push branch triggers
- Firestore state can come from live docs, transient overlay or bootstrap fallback; consumer must read `dataSource` and `fallbackReason`

### Что новый разработчик должен знать в первый день

1. Это не stealth remote-control project. Любое развитие должно сохранять trusted visible model.
2. `packages/contracts` и `packages/config` — центральные shared packages. Любое изменение API/mobile/agent лучше начинать с них.
3. `apps/api/src/app.ts` — главный composition root backend.
4. `apps/mobile/src/state/operator-store.ts` — главный orchestration layer на клиенте.
5. `apps/desktop-agent/src/runtime.ts` — главный orchestration layer агента.
6. `/ready` должен быть честным. Не “чинить” его подделкой статусов.
7. First live deploy уже был, но не все integrations smoke-tested.
8. Не добавлять OpenAI runtime, GKE, stealth behavior или broad IAM grants без сильной причины.

### Документация и где она лежит

- repo overview:
  - `README.md`
- architecture:
  - `docs/ARCHITECTURE.md`
- deploy:
  - `docs/DEPLOY.md`
- resources:
  - `docs/GCP_RESOURCES.md`
- security:
  - `docs/SECURITY_MODEL.md`
- AI:
  - `docs/VERTEX.md`
- IAM:
  - `docs/IAM_PLAN.md`
- pass status:
  - `docs/PASS2_STATUS.md`
  - `docs/PASS3_STATUS.md`
- this export:
  - `docs/CLAUDE_CODE_EXPORT.md`

### Ссылки на важные ресурсы

- GitHub repository:
  - `https://github.com/BusyaPrime/Operator-OS-Dev.git`
- GCP project:
  - `operator-os-dev`
- deployed Cloud Run URL:
  - `https://operator-os-api-m545sz2isq-ez.a.run.app`

### Короткий code example: readiness route

```ts
app.get('/ready', async (_, reply) => {
  const payload = healthResponseSchema.parse(options.buildReadiness());

  if (payload.status === 'degraded') {
    reply.code(503);
  }

  return payload;
});
```

Источник:

- `apps/api/src/routes/health.ts`

### Короткий code example: Vertex provider entrypoint

```ts
async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
  if (!this.#adcStatus.available) {
    throw new IntegrationError({
      code: 'missing_adc',
      dependency: 'vertex',
      message: this.#adcStatus.message,
      statusCode: 503
    });
  }

  const model = this.#getModel(input.maxOutputTokens);
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }]
  });

  return {
    provider: this.name,
    model: this.model,
    text: this.#extractText(result.response)
  };
}
```

Источник:

- `apps/api/src/providers/vertex-ai-provider.ts`

### Короткий code example: desktop safety guarantee

```ts
if (!this.#config.ENABLE_COMMAND_EXECUTION) {
  this.#logger.warn(
    { command },
    'command execution is disabled; stub recorded the command without touching the OS'
  );
  return;
}
```

Источник:

- `apps/desktop-agent/src/safe-command-executor.ts`

---

## Итог для Claude Code

Если этот документ передается в другой AI-инструмент, ключевой operational summary такой:

- это monorepo с тремя runtime surfaces: API, mobile, desktop-agent
- backend — один Fastify service на Cloud Run
- data contracts и env parsing вынесены в shared packages
- проект уже имеет реальный Cloud Run deployment, но live validation всех интеграций еще не завершена
- самое важное архитектурное ограничение — trusted, visible, no-stealth control model
- главное техническое место входа в backend — `apps/api/src/app.ts`
- главное облачное состояние и blockers описаны в `docs/PASS3_STATUS.md`

