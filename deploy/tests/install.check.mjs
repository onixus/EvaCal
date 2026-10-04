import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const deploy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(deploy, 'install.sh');
const revision = '1'.repeat(40);

function fixture(t) {
  // The installer resolves symlinks (macOS: /var -> /private/var), so compare real paths.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'evacal-deploy-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'),
    dir = path.join(root, 'installation with spaces'),
    source = path.join(root, 'source tree');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(source, 'deploy', 'nginx'), { recursive: true });
  for (const name of fs.readdirSync(deploy)) {
    if (fs.statSync(path.join(deploy, name)).isFile())
      fs.copyFileSync(path.join(deploy, name), path.join(source, 'deploy', name));
  }
  fs.writeFileSync(path.join(source, 'Dockerfile'), 'FROM scratch\n');
  for (const name of ['http.conf', 'https.conf'])
    fs.writeFileSync(
      path.join(source, 'deploy', 'nginx', name),
      '# test template __HTTPS_PORT_SUFFIX__\n',
    );
  const log = path.join(root, 'calls.jsonl');
  fs.writeFileSync(log, '');
  const stateFile = path.join(root, 'docker-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ image: 'sha256:old', tag: 'sha256:old', running: true }),
  );
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE));
const save = () => fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state));
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({a, cwd:process.cwd(), database:process.env.DATABASE_URL, pgUrl:process.env.EVACAL_PG_URL, image:state.image})+'\\n');
if (a[0] === 'stop') { state.running=false; save(); }
if (a[0] === 'start') { state.running=true; save(); }

if (a[0] === 'image' && a[1] === 'tag') {
  state.pins = {...state.pins, [a[3]]: a[2]}; save();
} else if (a[0] === 'image' && a[1] === 'rm') {
  delete state.pins?.[a[2]]; save();
} else if (a[0] === 'pull') {
  if (process.env.MOCK_FAIL_PULL && a.join(' ').includes(process.env.MOCK_FAIL_PULL)) process.exit(1);
} else if (a[0] === 'ps') console.log(process.env.MOCK_OWNER_DIR || '');
else if (a[0] === 'image' && a[1] === 'inspect') {
  const image = a.at(-1), migrate = image.includes('migrate');
  if (a.some(x => x.includes('.RepoDigests'))) console.log(image.slice(0,image.lastIndexOf(':')) + '@sha256:' + (migrate?'b':'a').repeat(64));
  else console.log(migrate ? (process.env.MOCK_MIGRATE_REV || '${revision}') : '${revision}');
} else if (a[0] === 'run') {
  // Rebuilding a mutable tag can make the old container image ID unresolvable.
  if (process.env.MOCK_IMAGE_GC && state.image !== state.tag &&
      a.includes('--entrypoint') && !a.some(x => state.pins?.[x] === state.image)) process.exit(125);
  if (a.includes('--entrypoint') && a.includes('tar')) process.stdout.write(require('zlib').gzipSync(Buffer.alloc(1024)));
  if (a.includes('psql') && process.env.MOCK_FAIL_PG_PREFLIGHT) process.exit(1);
  if (a.includes('pg_dump')) { if(process.env.MOCK_FAIL_BACKUP) process.exit(1); process.stdout.write('external database dump'); }
  if (a.includes('pg_restore') && process.env.MOCK_FAIL_RESTORE) process.exit(1);

} else if (a[0] === 'inspect') {
  const template = a[2] || '';
  if (template.includes('.Mounts')) console.log(template.includes('/app/storage') ? 'custom_storage-data' : '');
  else if (template.includes('.Image')) console.log(state.image);
  else if (template.includes('.State.Running')) console.log(state.running ? 'true' : 'false');
  else if (template.includes('.NetworkSettings.Networks')) console.log('fixture_default');
  else if (template.includes('.State.ExitCode')) console.log('0');
  else if (template.includes('.State.Health.Status') && !template.includes('.State.Status')) console.log('healthy');
  else console.log(a.at(-1)==='web-id' ? (process.env.MOCK_WEB_STATE || 'running healthy') : 'running healthy');
} else if (a[0] === 'compose') {
  const args = a.slice(1);
  for (const flag of ['--project-directory', '--env-file']) { const i=args.indexOf(flag); if(i>=0) args.splice(i,2); }
  if (args[0] === 'version') console.log(process.env.MOCK_COMPOSE_VERSION || '2.29.0');
  else if (args[0] === 'ps' && args.includes('-q')) console.log(args.at(-1)+'-id');
  else if (args[0] === 'config' && args.includes('--services')) console.log('app\\nweb\\nmigrate\\npostgres\\ndb-tools');
  else if (args[0] === 'config' && process.env.MOCK_BAD_CONFIG) process.exit(1);
  else if (args[0] === 'exec' && args.includes('psql')) { if(process.env.MOCK_FAIL_LOCAL_PG_AUTH) process.exit(1); else console.log('1'); }
  else if (args[0] === 'exec' && args.includes('pg_dump')) { if(process.env.MOCK_FAIL_BACKUP) process.exit(1); process.stdout.write('fake database dump'); }
  else if (args[0] === 'logs' && process.env.MOCK_BANNER) console.log('migrate-1 | ======================================================================\\nmigrate-1 | test-only credentials\\nmigrate-1 | ======================================================================');
  else if (args[0] === 'build') { state.tag=process.env.MOCK_BUILD_IMAGE || state.tag; save(); }
  else if (args[0] === 'up') {
    if (process.env.MOCK_FAIL_UP) process.exit(1);
    if (!args.includes('--no-deps') || args.includes('app')) state.image=state.tag;
    state.running=true; save();
  }

}
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, 'curl'),
    `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), a=process.argv.slice(2);
const url=a.find(x=>x.startsWith('https://')), out=a[a.indexOf('-o')+1];
if (process.env.MOCK_FAIL_DOWNLOAD && url.includes(process.env.MOCK_FAIL_DOWNLOAD)) process.exit(22);
fs.copyFileSync(path.join(process.env.MOCK_SOURCE, 'deploy', url.split('/deploy/')[1]), out);
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    MOCK_LOG: log,
    MOCK_SOURCE: source,
    MOCK_STATE: stateFile,
    EVACAL_BIN_DIR: path.join(root, 'commands'),
    EVACAL_HEALTH_TIMEOUT: '1',
    EVACAL_DIR: '',
    EVACAL_TAG: '',
    EVACAL_DOMAIN: '',
  };
  const run = (args, extra = {}, script = installer, withDir = true) =>
    spawnSync('bash', [script, ...args, ...(withDir ? ['--dir', dir] : [])], {
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 20000,
      cwd: root,
    });
  const calls = () =>
    fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const ok = (r) => assert.equal(r.status, 0, r.stderr || r.stdout || r.error?.message);
  function value(key) {
    const r = spawnSync(
      'bash',
      ['-c', 'source "$1"; INSTALL_DIR="$2"; env_get "$3"', 'test', installer, dir, key],
      { env, encoding: 'utf8' },
    );
    ok(r);
    return r.stdout;
  }
  return {
    root,
    dir,
    source,
    env,
    run,
    calls,
    value,
    ok,
    state: () => JSON.parse(fs.readFileSync(stateFile)),
    clear: () => fs.writeFileSync(log, ''),
  };
}

test('help needs no Docker and creates no installation', (t) => {
  const f = fixture(t);
  f.ok(f.run(['--help']));
  assert.equal(fs.existsSync(f.dir), false);
  assert.equal(f.calls().length, 0);
});
for (const args of [['--version'], ['--unknown-database'], ['--cert', 'missing'], ['typo']]) {
  test(`bad arguments fail before Docker: ${args.join(' ')}`, (t) => {
    const f = fixture(t),
      r = f.run(args, {}, installer, false);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stderr, /unbound variable/);
    assert.equal(f.calls().length, 0);
  });
}
test('dotenv literals round-trip without execution and are mode 600', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.dir);
  const value = 'space #hash $HOME ${FOO} $(touch should-not-exist) \'quote" and \\backslash\\';
  const r = spawnSync(
    'bash',
    [
      '-c',
      'source "$1"; INSTALL_DIR="$2"; env_set DATABASE_URL "$VALUE"; env_get DATABASE_URL',
      'test',
      installer,
      f.dir,
    ],
    { env: { ...f.env, VALUE: value }, encoding: 'utf8', cwd: f.root },
  );
  f.ok(r);
  assert.equal(r.stdout, value);
  assert.equal(fs.statSync(path.join(f.dir, '.env')).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(f.root, 'should-not-exist')), false);
});
test('local install pins digests, preserves secrets and resolves its symlink', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local', '--version', 'v1.2.3', '--yes'], { MOCK_BANNER: '1' }));
  assert.equal(f.value('EVACAL_TAG'), '1.2.3');
  assert.equal(f.value('EVACAL_BIND_ADDRESS'), '127.0.0.1');
  assert.equal(f.value('EVACAL_HTTP_PORT'), '8080');
  assert.equal(f.value('FORCE_SECURE_COOKIES'), 'false');
  assert.equal(f.value('EVACAL_LOCAL_HTTP'), 'true');
  assert.match(f.value('EVACAL_APP_REF'), /@sha256:a{64}$/);
  assert.match(f.value('EVACAL_MIGRATE_REF'), /@sha256:b{64}$/);
  assert.equal(f.value('EVACAL_CONFIG_REF'), revision);
  assert.match(f.value('COMPOSE_FILE'), /postgres/);
  assert.doesNotMatch(f.value('COMPOSE_FILE'), /tls/);
  assert.equal(fs.statSync(path.join(f.dir, 'credentials.txt')).mode & 0o777, 0o600);
  const secret = f.value('SESSION_SECRET'),
    password = f.value('POSTGRES_PASSWORD');
  f.ok(f.run(['install', '--yes']));
  assert.equal(f.value('SESSION_SECRET'), secret);
  assert.equal(f.value('POSTGRES_PASSWORD'), password);
  const link = path.join(f.root, 'commands', 'evacal');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  f.clear();
  f.ok(f.run(['status'], {}, link, false));
  assert.ok(
    f
      .calls()
      .filter((x) => x.a[0] === 'compose' && !x.a.includes('version'))
      .every((x) => x.a.includes(f.dir)),
  );
});
for (const [label, extra] of [
  ['pull', { MOCK_FAIL_PULL: 'evacal-migrate:1.2.4' }],
  ['download', { MOCK_FAIL_DOWNLOAD: 'docker-compose.tls.yml' }],
  ['mismatched revisions', { MOCK_MIGRATE_REV: '2'.repeat(40) }],
  ['bad compose', { MOCK_BAD_CONFIG: '1' }],
]) {
  test(`failed ${label} preserves live files and never stops services`, (t) => {
    const f = fixture(t);
    f.ok(f.run(['install', '--local', '--version', '1.2.3', '--yes']));
    const before = fs.readFileSync(path.join(f.dir, '.env'), 'utf8'),
      script = fs.readFileSync(path.join(f.dir, 'evacal'), 'utf8');
    f.clear();
    assert.notEqual(f.run(['update', '--version', '1.2.4', '--yes'], extra).status, 0);
    assert.equal(fs.readFileSync(path.join(f.dir, '.env'), 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(f.dir, 'evacal'), 'utf8'), script);
    assert.equal(
      f
        .calls()
        .some(
          (x) =>
            x.a.includes('stop') ||
            x.a.includes('up') ||
            (x.a[0] === 'compose' && x.a.includes('rm')),
        ),
      false,
    );
    assert.equal(
      fs.readdirSync(f.dir).some((x) => x.startsWith('.prepare.')),
      false,
    );
  });
}
test('external PostgreSQL needs no local database and preserves dollars', (t) => {
  const f = fixture(t),
    url = 'postgresql://user:p$WORD%23@database:5432/evacal';
  f.ok(f.run(['install', '--local', '--database-url', url, '--yes']));
  assert.equal(f.value('DATABASE_URL'), url);
  assert.doesNotMatch(f.value('COMPOSE_FILE'), /postgres/);
});
test('embedded PostgreSQL authenticates with saved credentials before migration', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local']));
  const calls = f.calls(),
    auth = calls.findIndex(
      (x) => x.a[0] === 'compose' && x.a.includes('exec') && x.a.includes('psql'),
    );
  const fullUp = calls.findIndex(
    (x, i) =>
      i > auth && x.a[0] === 'compose' && x.a.includes('up') && x.a.includes('--remove-orphans'),
  );
  assert.ok(auth >= 0 && fullUp > auth);
  const host = calls[auth].a[calls[auth].a.indexOf('-h') + 1];
  assert.equal(host, 'postgres');
  assert.ok(calls[auth].a.includes('PGPASSWORD'));
  assert.equal(
    calls[auth].a.some((x) => x.startsWith('PGPASSWORD=')),
    false,
  );
});
test('embedded PostgreSQL auth failure aborts before migration/app startup', (t) => {
  const f = fixture(t),
    r = f.run(['install', '--local'], { MOCK_FAIL_LOCAL_PG_AUTH: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /POSTGRES_USER\/POSTGRES_PASSWORD/);
  const calls = f.calls(),
    auth = calls.findIndex((x) => x.a.includes('psql'));
  assert.ok(auth >= 0);
  assert.equal(
    calls
      .slice(auth + 1)
      .some((x) => x.a[0] === 'compose' && x.a.includes('up') && x.a.includes('--remove-orphans')),
    false,
  );
});
test('PostgreSQL source install uses local app images and retains its database service', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local', '--source', f.source, '--yes']));
  assert.equal(f.value('DATABASE_URL'), '');
  assert.match(f.value('COMPOSE_FILE'), /postgres/);
  assert.match(f.value('COMPOSE_FILE'), /build/);
  assert.equal(f.value('DATABASE_PROVIDER'), '');
  assert.equal(
    f.calls().some((x) => x.a[0] === 'pull'),
    false,
  );
  assert.ok(f.calls().some((x) => x.a.includes('build')));
});
test('bad ports and Compose v1 do not commit configuration', (t) => {
  const f = fixture(t);
  assert.notEqual(f.run(['install', '--local', '--http-port', '70000']).status, 0);
  assert.equal(fs.existsSync(path.join(f.dir, '.env')), false);
  assert.notEqual(f.run(['install', '--local'], { MOCK_COMPOSE_VERSION: '1.29.2' }).status, 0);
});
test('another installation using the project name is not touched', (t) => {
  const f = fixture(t);
  assert.notEqual(
    f.run(['install', '--local'], { MOCK_OWNER_DIR: '/different/installation' }).status,
    0,
  );
  assert.equal(
    f.calls().some((x) => x.a.includes('stop') || x.a.includes('up')),
    false,
  );
});
test('unhealthy web is not a successful install', (t) => {
  const f = fixture(t),
    r = f.run(['install', '--local'], { MOCK_WEB_STATE: 'exited unhealthy' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /готовности app и web/);
});
test('saved configuration overrides exported developer settings', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local'], { DATABASE_URL: 'file:wrong.db' }));
  assert.ok(
    f
      .calls()
      .filter((x) => x.a[0] === 'compose' && !x.a.includes('version'))
      .every((x) => x.database === undefined),
  );
});
test('purge requires confirmation and never removes shared images', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local']));
  f.clear();
  assert.notEqual(f.run(['uninstall', '--purge']).status, 0);
  assert.equal(fs.existsSync(f.dir), true);
  f.ok(f.run(['uninstall', '--purge', '--yes']));
  assert.equal(fs.existsSync(f.dir), false);
  assert.equal(
    f.calls().some((x) => x.a.includes('prune') || x.a.includes('--rmi')),
    false,
  );
});
test('archive traversal is rejected before extraction', (t) => {
  const f = fixture(t),
    file = path.join(f.root, 'malicious.tar.gz'),
    header = Buffer.alloc(512);
  header.write('../escape');
  header.write('0000600\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write('00000000000\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write(
    header
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148,
  );
  const zipped = spawnSync('gzip', ['-c'], { input: Buffer.concat([header, Buffer.alloc(1024)]) });
  assert.equal(zipped.status, 0);
  fs.writeFileSync(file, zipped.stdout);
  const r = spawnSync(
    'bash',
    ['-c', 'source "$1"; validate_archive "$2"', 'test', installer, file],
    { encoding: 'utf8' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Небезопасные пути/);
});

test('update backs up before migration, keeps the selected tag and never prunes images', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local', '--version', '1.2.3']));
  f.clear();
  f.ok(f.run(['update', '--yes']));
  assert.equal(f.value('EVACAL_TAG'), '1.2.3');
  const files = fs.readdirSync(path.join(f.dir, 'backups')).filter((x) => x.endsWith('.tar.gz'));
  assert.equal(files.length, 1);
  assert.equal(fs.statSync(path.join(f.dir, 'backups', files[0])).mode & 0o777, 0o600);
  const calls = f.calls(),
    dump = calls.findIndex((x) => x.a.includes('pg_dump')),
    migrate = calls.findIndex((x) => x.a.includes('rm') && x.a.includes('migrate'));
  assert.ok(dump >= 0 && migrate > dump);
  assert.equal(
    calls.some((x) => x.a.includes('prune')),
    false,
  );
  assert.ok(calls.some((x) => x.a.some((v) => v.includes('source=custom_storage-data'))));
});

test('failed backup aborts update before replacing live configuration', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local', '--version', '1.2.3']));
  const before = fs.readFileSync(path.join(f.dir, '.env'), 'utf8');
  f.clear();
  assert.notEqual(f.run(['update', '--version', '1.2.4'], { MOCK_FAIL_BACKUP: '1' }).status, 0);
  assert.equal(fs.readFileSync(path.join(f.dir, '.env'), 'utf8'), before);
  assert.equal(
    f.calls().some((x) => x.a.includes('rm') && x.a.includes('migrate')),
    false,
  );
});

// Review regressions: lifecycle is mocked, but archive validation executes
// the actual implementation against isolated files, not canned success output.
function shell(f, code, args = [], extra = {}) {
  return spawnSync(
    'bash',
    ['-c', 'source "$1"; INSTALL_DIR="$2"; shift 2; ' + code, 'test', installer, f.dir, ...args],
    { env: { ...f.env, ...extra }, encoding: 'utf8', cwd: f.root },
  );
}

for (const [input, expected] of [
  ['postgresql://u:p@db/app', 'postgresql://u:p@db/app'],
  ['postgres://u:p@db/app?schema=public', 'postgres://u:p@db/app'],
  [
    'postgresql://u:p%26%23$word@[::1]:5432/app?schema=custom&sslmode=verify-full&sslrootcert=%2Fcerts%2Fca.pem&connect_timeout=8',
    'postgresql://u:p%26%23$word@[::1]:5432/app?sslmode=verify-full&sslrootcert=%2Fcerts%2Fca.pem&connect_timeout=8',
  ],
  [
    'postgresql://u:p@db/app?connection_limit=5&pool_timeout=10&pgbouncer=true&statement_cache_size=0&socket_timeout=20&application_name=evacal',
    'postgresql://u:p@db/app?application_name=evacal',
  ],
  [
    'postgresql://u:p@db/app?sslmode=require&schema=a&options=-c%20search_path%3Da',
    'postgresql://u:p@db/app?sslmode=require&options=-c%20search_path%3Da',
  ],
  [
    'postgresql://u:p@db/app?schema=public&sslaccept=strict',
    'postgresql://u:p@db/app?sslaccept=strict',
  ],
]) {
  test(`PostgreSQL CLI normalization preserves connection/TLS options: ${input.split('?')[1] || 'plain'}`, (t) => {
    const f = fixture(t),
      r = shell(f, 'postgres_cli_url "$1"', [input]);
    f.ok(r);
    assert.equal(r.stdout, expected);
  });
}
for (const input of [
  'file:dev.db',
  'postgresql://db/a?schema',
  'postgresql://db/a?%73chema=public',
]) {
  test(`PostgreSQL CLI rejects malformed/ambiguous input: ${input}`, (t) => {
    const f = fixture(t);
    assert.notEqual(shell(f, 'postgres_cli_url "$1"', [input]).status, 0);
  });
}

test('failed source-update backup resumes original IDs, never the newly built image', (t) => {
  const f = fixture(t);
  f.ok(
    f.run(['install', '--source', f.source, '--local'], { MOCK_BUILD_IMAGE: 'sha256:old-source' }),
  );
  const before = fs.readFileSync(path.join(f.dir, '.env'), 'utf8');
  f.clear();
  const r = f.run(['update'], { MOCK_BUILD_IMAGE: 'sha256:new-source', MOCK_FAIL_BACKUP: '1' });
  assert.notEqual(r.status, 0);
  assert.equal(f.state().tag, 'sha256:new-source');
  assert.equal(f.state().image, 'sha256:old-source');
  assert.equal(f.state().running, true);
  assert.equal(fs.readFileSync(path.join(f.dir, '.env'), 'utf8'), before);
  assert.deepEqual(
    f
      .calls()
      .filter((x) => x.a[0] === 'start')
      .map((x) => x.a),
    [['start', 'app-id', 'web-id']],
  );
  assert.equal(
    f.calls().some((x) => x.a.includes('up')),
    false,
  );
});

test('successful update keeps writers stopped between snapshot and migration', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--source', f.source, '--local']));
  f.clear();
  f.ok(f.run(['update'], { MOCK_BUILD_IMAGE: 'sha256:new-source', MOCK_IMAGE_GC: '1' }));
  assert.deepEqual(f.state().pins, {}, 'temporary image pin must be removed');
  const calls = f.calls(),
    dump = calls.findIndex((x) => x.a.includes('pg_dump'));
  const migrate = calls.findIndex((x) => x.a.includes('rm') && x.a.includes('migrate'));
  assert.ok(dump > 0 && migrate > dump);
  assert.equal(
    calls.slice(dump, migrate).some((x) => x.a.includes('start') || x.a.includes('up')),
    false,
  );
  assert.equal(f.state().image, 'sha256:new-source');
});

test('standalone backup resumes existing containers even when the local tag changes', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--source', f.source, '--local']));
  f.clear();
  f.ok(shell(f, 'compose build app migrate', [], { MOCK_BUILD_IMAGE: 'sha256:unmigrated' }));
  f.ok(f.run(['backup']));
  assert.equal(f.state().image, 'sha256:old');
  assert.equal(f.state().running, true);
  assert.equal(
    f.calls().some((x) => x.a.includes('up')),
    false,
  );
  assert.ok(f.calls().some((x) => x.a[0] === 'start'));
});

function tar(f, file, dir, entries) {
  f.ok(
    spawnSync(
      'tar',
      ['-czf', file, '-C', dir, ...(entries.length ? entries : ['-T', '/dev/null'])],
      { encoding: 'utf8' },
    ),
  );
}
function backupFixture(f, provider = 'postgresql', dump = 'fixture custom dump') {
  const dir = fs.mkdtempSync(path.join(f.root, 'backup-'));
  fs.writeFileSync(path.join(dir, 'PROVIDER'), provider + '\n');
  tar(f, path.join(dir, 'storage.tgz'), dir, []);
  if (dump !== null) fs.writeFileSync(path.join(dir, 'db.dump'), dump);
  const file = path.join(dir, 'backup.tar.gz');
  tar(f, file, dir, ['PROVIDER', 'storage.tgz', ...(dump === null ? [] : ['db.dump'])]);
  return file;
}

for (const [name, provider, dump] of [
  ['unsupported archive', 'unsupported', 'dump'],
  ['missing dump', 'postgresql', null],
  ['empty dump', 'postgresql', ''],
]) {
  test(`restore rejects ${name} before stopping services`, (t) => {
    const f = fixture(t);
    f.ok(f.run(['install', '--local']));
    const before = fs.readFileSync(path.join(f.dir, '.env'));
    const file = backupFixture(f, provider, dump);
    f.clear();
    assert.notEqual(f.run(['restore', file, '--yes']).status, 0);
    assert.deepEqual(fs.readFileSync(path.join(f.dir, '.env')), before);
    assert.equal(
      f
        .calls()
        .some((x) => x.a.includes('stop') || x.a.includes('up') || x.a.includes('pg_restore')),
      false,
    );
  });
}

for (const [key, value] of [
  ['DATABASE_URL', 'file:./local.db'],
  ['DATABASE_PROVIDER', 'unsupported'],
]) {
  for (const command of ['install', 'update', 'backup', 'restore', 'start', 'restart']) {
    test(`${command} rejects an incompatible saved ${key} before changing the installation`, (t) => {
      const f = fixture(t);
      f.ok(f.run(['install', '--local']));
      fs.appendFileSync(path.join(f.dir, '.env'), `${key}="${value}"\n`);
      const before = fs.readFileSync(path.join(f.dir, '.env'));
      const file = backupFixture(f);
      f.clear();
      const args = [
        command,
        '--yes',
        ...(command === 'restore' ? [file] : []),
        ...(command === 'install' || command === 'update'
          ? ['--database-url', 'postgresql://u:p@db/app', '--skip-backup']
          : []),
      ];
      const result = f.run(args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PostgreSQL/);
      assert.deepEqual(fs.readFileSync(path.join(f.dir, '.env')), before);
      assert.equal(
        f
          .calls()
          .some((x) =>
            ['stop', 'start', 'up', 'pg_restore', 'pg_dump', 'build', 'pull'].some((a) =>
              x.a.includes(a),
            ),
          ),
        false,
      );
    });
  }
}

test('existing PostgreSQL provider flag is retired while passwords and project stay unchanged', (t) => {
  const f = fixture(t);
  f.ok(f.run(['install', '--local']));
  const password = f.value('POSTGRES_PASSWORD'),
    project = f.value('COMPOSE_PROJECT_NAME');
  fs.appendFileSync(path.join(f.dir, '.env'), 'DATABASE_PROVIDER=postgresql\n');
  f.ok(f.run(['update', '--yes']));
  assert.equal(f.value('DATABASE_PROVIDER'), '');
  assert.equal(f.value('POSTGRES_PASSWORD'), password);
  assert.equal(f.value('COMPOSE_PROJECT_NAME'), project);
});

test('external backup and restore use a libpq URL via env and preflight before stopping', (t) => {
  const f = fixture(t),
    url = 'postgresql://u:p%24word@external:5432/db?schema=public&sslmode=require';
  f.ok(f.run(['install', '--local', '--database-url', url]));
  const file = backupFixture(f, 'postgresql');
  for (const args of [['backup'], ['restore', file, '--yes']]) {
    f.clear();
    f.ok(f.run(args));
    const calls = f.calls(),
      preflight = calls.findIndex((x) => x.a.includes('psql'));
    const stop = calls.findIndex((x) => x.a.includes('stop'));
    assert.ok(preflight >= 0 && stop > preflight);
    const clients = calls.filter(
      (x) => x.a.includes('psql') || x.a.includes('pg_dump') || x.a.includes('pg_restore'),
    );
    assert.ok(clients.length >= 2);
    for (const call of clients) {
      assert.equal(call.pgUrl, 'postgresql://u:p%24word@external:5432/db?sslmode=require');
      assert.equal(
        call.a.some((a) => a.includes('p%24word')),
        false,
      );
      assert.ok(call.a.includes('fixture_default'));
    }
    assert.equal(f.value('DATABASE_URL'), url);
  }
});
for (const command of ['backup', 'restore']) {
  test(`failed external ${command} preflight does not stop the application`, (t) => {
    const f = fixture(t);
    f.ok(
      f.run([
        'install',
        '--local',
        '--database-url',
        'postgresql://u:p@db/app?schema=public&sslaccept=strict',
      ]),
    );
    const file = backupFixture(f, 'postgresql');
    f.clear();
    const r = f.run([command, ...(command === 'restore' ? [file, '--yes'] : [])], {
      MOCK_FAIL_PG_PREFLIGHT: '1',
    });
    assert.notEqual(r.status, 0);
    assert.equal(
      f
        .calls()
        .some(
          (x) =>
            x.a.includes('stop') ||
            x.a.includes('up') ||
            x.a.includes('pg_restore') ||
            x.a.includes('pg_dump'),
        ),
      false,
    );
  });
}

test('historical 0.6.0 updater retains PostgreSQL without learning new overlay filenames', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.dir, 'nginx'), { recursive: true });
  const legacyEnv =
    'COMPOSE_PROJECT_NAME=evacal\nCOMPOSE_FILE=docker-compose.yml:docker-compose.tls.yml\nEVACAL_TAG=0.6.0\nEVACAL_TLS=yes\nDATABASE_PROVIDER=postgresql\nPOSTGRES_DB=evacal\nPOSTGRES_USER=evacal\nPOSTGRES_PASSWORD=keep-me\nSESSION_SECRET=keep-session\n';
  fs.writeFileSync(path.join(f.dir, '.env'), legacyEnv);
  fs.writeFileSync(
    path.join(f.dir, 'docker-compose.yml'),
    'services:\n  postgres:\n    image: postgres:16-alpine\n',
  );
  const r = spawnSync(
    'bash',
    [
      '-c',
      `
    set -euo pipefail
    source "$1"
    INSTALL_DIR="$2"; REPO_ROOT=''; OPT_TAG=1.2.3
    EVACAL_RAW_BASE=https://raw.githubusercontent.com/onixus/EvaCal
    info() { :; }; warn() { :; }; step() { :; }; die() { echo "$*" >&2; exit 1; }
    require_installed() { test -f "$INSTALL_DIR/.env"; }
    compose() { (cd "$INSTALL_DIR" && docker compose "$@"); }
    render_nginx() { cp "$INSTALL_DIR/nginx/http.conf" "$INSTALL_DIR/nginx/nginx.conf"; }
    wait_healthy() { :; }; reload_nginx() { :; }; print_address() { :; }
    ln() { :; } # Never write the historical global /usr/local/bin symlink in a test.
    cmd_update
  `,
      'legacy-test',
      path.join(deploy, 'tests/fixtures/legacy-updater.sh'),
      f.dir,
    ],
    { env: f.env, encoding: 'utf8', cwd: f.root },
  );
  f.ok(r);
  assert.equal(f.value('COMPOSE_FILE'), 'docker-compose.yml:docker-compose.tls.yml');
  assert.equal(f.value('POSTGRES_PASSWORD'), 'keep-me');
  assert.equal(fs.existsSync(path.join(f.dir, 'docker-compose.postgres.yml')), false);
  assert.equal(fs.existsSync(path.join(f.dir, 'docker-compose.base.yml')), false);
  const config = fs.readFileSync(path.join(f.dir, 'docker-compose.yml'), 'utf8');
  assert.match(config, /^  postgres:\n    image: postgres:16-alpine/m);
  assert.match(config, /- pg-data:\/var\/lib\/postgresql\/data/);
  assert.ok(f.calls().some((x) => x.a.includes('up') && x.a.includes('--remove-orphans')));
  // The following invocation uses the newly downloaded manager and migrates the
  // saved COMPOSE_FILE, while keeping the same project, secrets and volume names.
  f.ok(f.run(['update', '--skip-backup'], {}, path.join(f.dir, 'evacal')));
  assert.equal(
    f.value('COMPOSE_FILE'),
    'docker-compose.base.yml:docker-compose.postgres.yml:docker-compose.tls.yml',
  );
  assert.equal(f.value('COMPOSE_PROJECT_NAME'), 'evacal');
  assert.equal(f.value('POSTGRES_PASSWORD'), 'keep-me');
  assert.equal(f.value('SESSION_SECRET'), 'keep-session');
});
