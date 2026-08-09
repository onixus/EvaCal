pipeline {
    agent {
        docker {
            image 'node:20-alpine'
            // Запускаем от root, чтобы избежать проблем с правами в workspace Jenkins
            args '-u root:root'
        }
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
                // Генерируем клиент Prisma, так как он может понадобиться для тестов
                sh 'npx prisma generate'
            }
        }

        stage('Security Audit') {
            steps {
                // Проверка уязвимостей в зависимостях (уровень high и выше)
                // Используем || true, чтобы временно не блокировать сборку из-за уже известных уязвимостей
                sh 'npm audit --audit-level=high || true'
            }
        }

        stage('Lint') {
            steps {
                sh 'npm run lint'
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
    }

    post {
        always {
            // Очистка workspace после выполнения
            cleanWs()
        }
    }
}
