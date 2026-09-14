pipeline {
    agent {
        docker {
            image 'node:22.14-alpine3.21'
            args '-u root:root'
        }
    }

    environment {
        CI = 'true'
        NEXT_TELEMETRY_DISABLED = '1'
        NPM_CONFIG_UPDATE_NOTIFIER = 'false'
        // prisma.config.ts резолвит DATABASE_URL при любом запуске CLI, включая generate
        DATABASE_URL = 'file:./prisma/dev.db'

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
        stage('Checkout') {
            steps {
                checkout scm
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
                sh 'cd "$BUILD_DIR" && npm ci'
                sh 'cd "$BUILD_DIR" && npx prisma generate'
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
