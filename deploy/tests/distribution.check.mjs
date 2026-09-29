import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts });
const text = (path) => readFileSync(join(root, path), 'utf8');

for (const [ref, tag] of [['v1.2.3', '1.2.3'], ['v1.2.3-rc.1', '1.2.3-rc.1'], ['main', 'main'], ['feature/install', 'feature-install']]) {
  test(`publication tag: ${ref}`, () => {
    const r = run('bash', ['-c', 'source scripts/docker-publish.sh; publication_tag "$1"', 'bash', ref]);
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, tag);
  });
}
test('publication rejects shell metacharacters', () => {
  assert.notEqual(run('bash', ['-c', 'source scripts/docker-publish.sh; publication_tag "$1"', 'bash', 'v1;echo bad']).status, 0);
});
test('both stacks isolate mutable data from schemas and migrations', () => {
  for (const file of ['docker-compose.yml', 'deploy/docker-compose.yml', 'deploy/docker-compose.base.yml']) {
    assert.doesNotMatch(text(file), /- db-data:\/app\/prisma/);
    assert.equal((text(file).match(/- db-data:\/app\/data/g) || []).length, 2);
    assert.equal((text(file).match(/- storage-data:\/app\/storage/g) || []).length, 2);
  }
  assert.doesNotMatch(text('docker-migrate-entrypoint.sh'), /chown -R.*\/app\s/);
  assert.match(text('docker-entrypoint.sh'), /file:\/app\/data\/dev\.db/);
  const publish = text('scripts/docker-publish.sh');
  assert.ok(publish.indexOf('bash scripts/smoke-docker.sh') < publish.indexOf('docker buildx imagetools create'));
  assert.match(publish, /for target in runner migrate/);
});
test('deployment bundle contains matching manifest/config and verifiable checksum, no secrets', () => {
  const out = mkdtempSync(join(tmpdir(), 'evacal-package-'));
  try {
    const revision = 'a'.repeat(40);
    const r = run('bash', ['scripts/package-deploy.sh', '1.2.3', revision, out]);
    assert.equal(r.status, 0, r.stderr);
    const file = join(out, 'evacal-1.2.3-deploy.tar.gz');
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.equal(readFileSync(`${file}.sha256`, 'utf8').split(/\s/)[0], digest);
    const entries = run('tar', ['-tzf', file]).stdout.split('\n');
    for (const name of ['install.sh', 'README.md', 'RELEASE', 'docker-compose.yml', 'docker-compose.base.yml', 'docker-compose.postgres.yml', 'nginx/http.conf', 'nginx/https.conf']) {
      assert.ok(entries.includes(`evacal-1.2.3-deploy/${name}`), name);
    }
    assert.ok(!entries.some((f) => /(^|\/)\.env$|credentials|\.pem$|node_modules/.test(f)));
    assert.equal(run('tar', ['-xOzf', file, 'evacal-1.2.3-deploy/RELEASE']).stdout, `VERSION=1.2.3\nREVISION=${revision}\n`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

const hasCompose = run('docker', ['compose', 'version', '--short']).status === 0;
for (const mode of ['postgresql', 'external', 'sqlite', 'tls', 'root', 'legacy']) {
  test(`real Compose config: ${mode}`, { skip: !hasCompose && 'Docker Compose CLI is not installed' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'evacal-compose-'));
    try {
      // Exercise the actual dotenv serializer with Compose's actual parser.
      const secret = String.raw`Pa$word\\n#'"`;
      const entries = {
        SESSION_SECRET: secret, POSTGRES_PASSWORD: 'test-only',
        EVACAL_SOURCE: root, EVACAL_BIND_ADDRESS: '127.0.0.1', EVACAL_HTTP_PORT: '8080', EVACAL_HTTPS_PORT: '8443',
        DATABASE_PROVIDER: mode === 'sqlite' ? 'sqlite' : 'postgresql',
        DATABASE_URL: mode === 'external' ? 'postgresql://u:p@external:5432/db' : mode === 'sqlite' ? 'file:/app/data/dev.db' : '',
      };
      for (const [key, value] of Object.entries(entries)) {
        const r = run('bash', ['-c', 'source deploy/install.sh; INSTALL_DIR="$1"; env_set "$2" "$3"', 'bash', dir, key, value]);
        assert.equal(r.status, 0, r.stderr);
      }
      const args = ['compose', '--project-name', 'evacal-config-test', '--env-file', join(dir, '.env')];
      const files = mode === 'root' ? ['docker-compose.yml'] : [mode === 'legacy' ? 'deploy/docker-compose.yml' : 'deploy/docker-compose.base.yml'];
      if (mode === 'postgresql' || mode === 'tls') files.push('deploy/docker-compose.postgres.yml');
      if (mode === 'sqlite') files.push('deploy/docker-compose.build.yml');
      if (mode === 'tls') files.push('deploy/docker-compose.tls.yml');
      for (const file of files) args.push('-f', join(root, file));
      args.push('config', '--format', 'json');
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (/^(COMPOSE_|EVACAL_|DATABASE_|POSTGRES_|SESSION_|SHARE_|S3_)/.test(key)) delete env[key];
      }
      const r = run('docker', args, { env }); assert.equal(r.status, 0, r.stderr);
      const config = JSON.parse(r.stdout);
      // Compose escapes literal dollars when serializing a reusable config.
      assert.equal(config.services.app.environment.SESSION_SECRET.replace(/\$\$/g, '$'), secret);
      const destinations = config.services.app.volumes.map((v) => v.target);
      assert.ok(destinations.includes('/app/data')); assert.ok(!destinations.includes('/app/prisma'));
      assert.equal(Boolean(config.services.postgres), ['postgresql', 'tls', 'root', 'legacy'].includes(mode));
      if (mode === 'legacy') {
        const modernArgs = [...args];
        const index = modernArgs.indexOf(join(root, 'deploy/docker-compose.yml'));
        modernArgs.splice(index, 1, join(root, 'deploy/docker-compose.base.yml'), '-f', join(root, 'deploy/docker-compose.postgres.yml'));
        const modern = run('docker', modernArgs, { env }); assert.equal(modern.status, 0, modern.stderr);
        assert.deepEqual(config, JSON.parse(modern.stdout), 'legacy stack must match base + PostgreSQL overlay');
      }
      if (mode === 'external') assert.equal(config.services.app.environment.DATABASE_URL, entries.DATABASE_URL);
      if (mode === 'sqlite') assert.equal(config.services.app.pull_policy, 'never');
      if (mode === 'tls') assert.deepEqual(config.services.web.ports.map((p) => p.host_ip), ['127.0.0.1', '127.0.0.1']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('branch names cannot overwrite reserved release/candidate tags', () => {
  for (const ref of ['latest', 'sha-' + 'a'.repeat(40), 'sha/' + 'a'.repeat(40), 'refs/heads/sha/' + 'b'.repeat(40), 'refs/tags/sha/' + 'c'.repeat(40)]) {
    assert.notEqual(run('bash', ['-c', 'source scripts/docker-publish.sh; publication_tag "$1"', 'bash', ref]).status, 0);
  }
});

test('manager refresh uses the selected source rather than the running script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evacal-manager-'));
  try {
    const source = join(dir, 'source'), destination = join(dir, 'installation');
    mkdirSync(destination); cpSync(join(root, 'deploy'), join(source, 'deploy'), { recursive: true });
    appendFileSync(join(source, 'deploy/install.sh'), '\n# updated-manager-fixture\n');
    writeFileSync(join(dir, 'old-manager'), '#!/bin/sh\n');
    const r = run('bash', ['-c',
      'source deploy/install.sh; SCRIPT_PATH="$1/old-manager"; SCRIPT_DIR=""; INSTALL_DIR="$1/installation"; fetch_config source "$1/source"',
      'bash', dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(destination, 'evacal'), 'utf8'), /# updated-manager-fixture/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
