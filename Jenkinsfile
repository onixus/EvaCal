pipeline {
    agent {
        docker {
            image 'node:20-alpine'
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
                sh 'apk add --no-cache openssl'
                sh 'npm ci'
                sh 'npx prisma generate'
            }
        }

        stage('Security Audit') {
            steps {
                // Fail on high/critical advisories. Force the public registry:
                // some mirrors (e.g. npmmirror) do not implement the audit API.
                sh 'npm audit --audit-level=high --registry=https://registry.npmjs.org/'
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
                    sh 'npm run test'
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
