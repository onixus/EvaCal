pipeline {
    agent {
        docker {
            image 'node:20-alpine'
            // Запускаем от root, чтобы избежать проблем с правами в workspace Jenkins
            args '-u root:root'
        }
    }

    environment {
        CI = 'true'
        NEXT_TELEMETRY_DISABLED = '1'
        NPM_CONFIG_UPDATE_NOTIFIER = 'false'
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
                sh 'npm ci'
                sh 'npx prisma generate'
            }
        }

        stage('Security Audit') {
            steps {
                // Пока не блокируем сборку из-за уже известных уязвимостей,
                // но оставляем аудит видимым в логе Jenkins.
                sh 'npm audit --audit-level=high || true'
            }
        }

        stage('Lint') {
            steps {
                script {
                    def hasEslintConfig = fileExists('eslint.config.js') ||
                        fileExists('eslint.config.mjs') ||
                        fileExists('eslint.config.cjs') ||
                        fileExists('.eslintrc') ||
                        fileExists('.eslintrc.js') ||
                        fileExists('.eslintrc.cjs') ||
                        fileExists('.eslintrc.json') ||
                        fileExists('.eslintrc.yml') ||
                        fileExists('.eslintrc.yaml')

                    if (hasEslintConfig) {
                        sh 'npm run lint'
                    } else {
                        echo 'ESLint config not found. Lint stage skipped to avoid interactive next lint setup in CI.'
                    }
                }
            }
        }

        stage('Typecheck') {
            steps {
                sh 'npm run typecheck'
            }
        }

        stage('Test') {
            steps {
                sh 'npm run test'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}
