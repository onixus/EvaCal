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
