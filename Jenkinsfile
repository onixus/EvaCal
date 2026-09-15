pipeline {
    // agent none на верхнем уровне — вынужденно и намеренно.
    //
    // Стадию с другим образом нельзя объявить внутри пайплайна, чей
    // верхнеуровневый агент сам является контейнером: Jenkins поднимает вложенный
    // агент ИЗНУТРИ него и упирается в отсутствие docker CLI. Билд #50 умер ровно
    // так — `docker: not found`, exit 127.
    //
    // Поэтому основные проверки собраны в одну родительскую стадию со своим
    // контейнером: внутри неё шаги по-прежнему делят общий /build, ради чего всё
    // и затевалось. E2E — её сосед со своим образом.
    agent none

    environment {
        CI = 'true'
        NEXT_TELEMETRY_DISABLED = '1'
        NPM_CONFIG_UPDATE_NOTIFIER = 'false'
        // Основная СУБД — PostgreSQL: клиент генерируется под неё, тесты и сборка
        // идут против неё. Сервер поднимается внутри агента (scripts/ci-postgres.sh),
        // DATABASE_URL выставляется после его старта в стадии Install Dependencies.
        DATABASE_PROVIDER = 'postgresql'

        // Сборка идёт НЕ в воркспейсе, а в файловой системе контейнера.
        //
        // Воркспейс Jenkins примонтирован с macOS через VirtioFS, и тот
        // недетерминированно теряет записи. Билд #45 (2026-09-14) поймал это
        // на ровном месте: `npm ci` разложил 613 пакетов, после чего tsc упал
        // с SyntaxError ВНУТРИ node_modules/typescript/lib/_tsc.js (файл
        // оборван посреди присваивания), vitest получил SIGILL, а нативный
        // SWC запаниковал с 0xFFFFFFFF в строке. Перезапуск #46 на той же
        // ревизии прошёл зелёным — код был ни при чём, побились байты.
        //
        // Тот же механизм и то же лечение, что у Rust-пайплайнов с
        // CARGO_TARGET_DIR на именованном томе: держать тяжёлую запись вне
        // bind-mount. Здесь это весь npm-цикл целиком.
        //
        // Путь фиксированный, а не производный от воркспейса, намеренно:
        // прибивать что-либо к пути воркспейса нельзя, параллельные стадии
        // получают <job>@2. Конфликта нет — контейнер свой на каждый прогон,
        // плюс disableConcurrentBuilds().
        BUILD_DIR = '/build'
    }

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    stages {
        stage('Проверки') {
            agent {
                docker {
                    image 'node:22.14-alpine3.21'
                    args '-u root:root'
                }
            }
            // Автоматический checkout отключён по той же причине, что и в E2E:
            // полный клон истории в воркспейс на VirtioFS теряет записи, и git
            // не может распаковать собственные объекты. Билд #58 умер на этом в
            // E2E, билд #68 — здесь: «inflate: data stream error (unknown
            // compression method)» на 2218 дельтах, все попытки подряд.
            options {
                skipDefaultCheckout()
            }

            stages {
                stage('Checkout') {
                    steps {
                        // Мелкий клон вместо полного и повтор с очисткой: объём
                        // записи падает на порядки, а гарантии здесь
                        // статистические — осечка не значит, что обречена и
                        // следующая попытка. deleteDir() обязателен, иначе
                        // повтор упрётся в мусор от неудачного клона.
                        retry(3) {
                            deleteDir()
                            checkout([
                                $class: 'GitSCM',
                                branches: scm.branches,
                                userRemoteConfigs: scm.userRemoteConfigs,
                                extensions: scm.extensions + [[
                                    $class: 'CloneOption',
                                    shallow: true,
                                    depth: 1,
                                    noTags: true,
                                    timeout: 10,
                                ]],
                            ])
                        }
                    }
                }

                stage('Install Dependencies') {
                    steps {
                        // Чтение с VirtioFS надёжно — теряются именно записи, поэтому
                        // копировать исходники наружу безопасно. tar, а не cp -a,
                        // ради --exclude (busybox tar 1.37 его поддерживает).
                        sh '''
                            set -eu
                            rm -rf "$BUILD_DIR"
                            mkdir -p "$BUILD_DIR"
                            tar -cf - --exclude=node_modules --exclude=.next . | (cd "$BUILD_DIR" && tar -xf -)
                        '''
                        script {
                            env.DATABASE_URL = sh(
                                returnStdout: true,
                                script: 'cd "$BUILD_DIR" && sh scripts/ci-postgres.sh',
                            ).trim()
                        }
                        sh 'cd "$BUILD_DIR" && npm ci'
                        sh 'cd "$BUILD_DIR" && npx prisma generate'
                        // Миграции PostgreSQL применяются к живой базе: сломанная
                        // миграция падает здесь, а не у пользователя при деплое.
                        sh 'cd "$BUILD_DIR" && npm run db:sync'
                    }
                }

                stage('Security Audit') {
                    steps {
                        catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
                            // Fail on high/critical advisories. Force public registry
                            sh 'cd "$BUILD_DIR" && npm audit --audit-level=high --registry=https://registry.npmjs.org/'
                        }
                    }
                }

                // Each check reports its own stage result instead of aborting the run,
                // so a lint failure can no longer hide a failing test. Any failure
                // still marks the whole build FAILURE.
                stage('Lint') {
                    steps {
                        catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                            sh 'cd "$BUILD_DIR" && npm run lint'
                        }
                    }
                }

                stage('Typecheck') {
                    steps {
                        catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                            sh 'cd "$BUILD_DIR" && npm run typecheck'
                        }
                    }
                }

                stage('Test') {
                    steps {
                        catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                            sh 'cd "$BUILD_DIR" && npm run test:ci'
                        }
                    }
                    post {
                        always {
                            // junit читает относительно воркспейса, а отчёт теперь
                            // пишется в $BUILD_DIR — вернуть его назад. Один мелкий
                            // файл: запись в bind-mount минимальна, и если отчёта нет
                            // (упал сам vitest), allowEmptyResults это переживёт.
                            sh 'cp "$BUILD_DIR/test-results.xml" "$WORKSPACE/" 2>/dev/null || true'
                            junit testResults: 'test-results.xml', allowEmptyResults: true
                        }
                    }
                }

                stage('Build') {
                    steps {
                        sh 'cd "$BUILD_DIR" && npm run build'
                    }
                }
            }
            post {
                always {
                    cleanWs()
                }
            }
        }

        // Сборка образа БЕЗ публикации. Ловит поломки Dockerfile на каждом
        // коммите, а не на релизе.
        //
        // Появилась после 0.5.0: коммит удалил медиа из public/, каталог опустел
        // и исчез из git, а Dockerfile его копирует — публикация упала на
        // "/app/public": not found. Раньше это ловил docker-publish.yml в GitHub
        // Actions, срабатывавший на каждый push в main; при переезде на Jenkins
        // публикация стала ручной по тегу, и постоянная проверка собираемости
        // пропала вместе с ней. Эта стадия её возвращает.
        //
        // Одна платформа и никакого --push: задача — проверить, что образ
        // вообще собирается. Мультиарх и публикация живут в Jenkinsfile.publish.
        stage('Docker image') {
            agent any
            steps {
                sh '''
                  set -eu
                  docker build -t evacal:ci-${BUILD_NUMBER} .
                '''
            }
            post {
                always {
                    sh 'docker image rm -f evacal:ci-${BUILD_NUMBER} || true'
                }
            }
        }

        // Сквозной сценарий: логин, проект, расчёт, мастер ГОСТ 34, выпуск
        // комплекта, утверждение. Стадия идёт последней — она самая долгая и
        // самая дорогая в диагностике, а быстрые проверки должны падать раньше.
        stage('E2E') {
            agent {
                // Собственный агент: Playwright не поддерживает Alpine — браузеры
                // собраны под glibc и на musl не запускаются. Официальный образ
                // несёт их предустановленными в /ms-playwright, тег обязан совпадать
                // с версией @playwright/test из package-lock.json, иначе Playwright
                // откажется работать с чужой сборкой браузера.
                docker {
                    image 'mcr.microsoft.com/playwright:v1.63.0-noble'
                    args '-u root:root'
                }
            }

            // Автоматический checkout отключён: он делал полный клон в воркспейс
            // Ева@2, который лежит на bind-mount VirtioFS. Билд #58 умер именно
            // на нём — «inflate: data stream error (unknown compression method)»
            // на 1913 дельтах: часть записей до диска не доехала, и git не смог
            // распаковать собственные объекты.
            //
            // Ниже checkout делается вручную и бережнее.
            options {
                skipDefaultCheckout()
            }

            steps {
                // Мелкий клон вместо полного: depth 1 без тегов пишет дерево
                // одного коммита вместо всей истории. Объём записи в VirtioFS
                // падает на порядки, а вместе с ним и шанс поймать потерю.
                //
                // Повтор с очисткой, потому что гарантии здесь статистические:
                // VirtioFS теряет записи недетерминированно, и осечка не значит,
                // что следующая попытка обречена. deleteDir() обязателен — после
                // неудачного клона в воркспейсе остаётся мусор, и повтор без
                // очистки упрётся в него, а не в чистое место.
                //
                // Ветку и remote берём у самой джобы, чтобы конфиг не разъезжался
                // с Jenkinsfile.
                retry(3) {
                    deleteDir()
                    checkout([
                        $class: 'GitSCM',
                        branches: scm.branches,
                        userRemoteConfigs: scm.userRemoteConfigs,
                        extensions: scm.extensions + [[
                            $class: 'CloneOption',
                            shallow: true,
                            depth: 1,
                            noTags: true,
                            timeout: 10,
                        ]],
                    ])
                }

                // Отдельный агент — отдельный воркспейс (Ева@2) со своим checkout,
                // поэтому /build из основного контейнера сюда не доезжает и весь
                // цикл повторяется здесь. Это цена изоляции: e2e не может испортить
                // сборку основных стадий, а его падение не смешивается с ними.
                sh '''
                    set -eu

                    # Пароль генерируется на каждый прогон и нигде не хранится:
                    # сид заводит учётки с ним, тест им же логинится. Credential
                    # в Jenkins заводить не требуется. Без E2E_ARCHITECT_PASSWORD
                    # тест молча скипается — это не успех, а пропуск.
                    PW=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
                    export SEED_DEFAULT_PASSWORD="$PW"
                    export E2E_ARCHITECT_PASSWORD="$PW"

                    # lib/auth.ts бросает исключение без SESSION_SECRET, и логин
                    # отвечает 500. Снаружи это выглядит как зависший сабмит формы,
                    # а не как отсутствующая переменная.
                    export SESSION_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=')
                    export SHARE_TOKEN_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=')

                    export CI=true
                    export NEXT_TELEMETRY_DISABLED=1
                    export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

                    rm -rf /e2e && mkdir -p /e2e
                    tar -cf - --exclude=node_modules --exclude=.next . | (cd /e2e && tar -xf -)
                    cd /e2e

                    # Сквозной сценарий идёт против той же СУБД, что и прод.
                    export DATABASE_PROVIDER=postgresql
                    export DATABASE_URL=$(sh scripts/ci-postgres.sh)

                    npm ci
                    npx prisma generate
                    npm run db:sync
                    npm run db:seed
                    npm run build

                    # --retries=0 намеренно, хотя playwright.config.ts ставит 2 на CI.
                    # Сценарий на первой попытке проходит обязательную смену пароля
                    # архитектора, поэтому повторная попытка логинится уже неверным
                    # паролем и падает на «Неверный логин или пароль». Ретраи здесь
                    # не лечат флак, а втрое удлиняют прогон и подменяют настоящую
                    # причину падения ложной.
                    npx playwright test --retries=0 --reporter=list
                '''
            }
            post {
                always {
                    // Отчёт и трассы забираются в воркспейс: внутри контейнера они
                    // исчезнут вместе с ним, а разбирать падение сквозного сценария
                    // без них почти невозможно.
                    sh 'cp -r /e2e/playwright-report "$WORKSPACE/" 2>/dev/null || true'
                    sh 'cp -r /e2e/test-results "$WORKSPACE/" 2>/dev/null || true'
                    archiveArtifacts artifacts: 'playwright-report/**, test-results/**',
                                     allowEmptyArchive: true, fingerprint: false
                    cleanWs()
                }
            }
        }
    }
}
