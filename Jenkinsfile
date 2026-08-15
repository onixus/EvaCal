pipeline {
    agent {
        docker {
            image 'node:22-alpine'
            args '-u root:root'
        }
    }

    environment {
        CI = 'true'
        NEXT_TELEMETRY_DISABLED = '1'
        NPM_CONFIG_UPDATE_NOTIFIER = 'false'
        // prisma.config.ts резолвит DATABASE_URL при любом запуске CLI, включая generate
        DATABASE_URL = 'file:./prisma/dev.db'
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
                catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
                    // Fail on high/critical advisories. Force public registry
                    sh 'npm audit --audit-level=high --registry=https://registry.npmjs.org/'
                }
            }
        }

        // Each check reports its own stage result instead of aborting the run,
        // so a lint failure can no longer hide a failing test. Any failure
        // still marks the whole build FAILURE.
        stage('Lint') {
            steps {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh 'npm run lint'
                }
            }
        }

        stage('Typecheck') {
            steps {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh 'npm run typecheck'
                }
            }
        }

        stage('Test') {
            steps {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh 'npm run test:ci'
                }
            }
            post {
                always {
                    junit testResults: 'test-results.xml', allowEmptyResults: true
                }
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
