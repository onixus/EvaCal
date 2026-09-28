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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evacal-deploy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'), dir = path.join(root, 'installation with spaces'), source = path.join(root, 'source tree');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(source, 'deploy', 'nginx'), { recursive: true });
  for (const name of fs.readdirSync(deploy)) {
    if (fs.statSync(path.join(deploy, name)).isFile()) fs.copyFileSync(path.join(deploy, name), path.join(source, 'deploy', name));
  }
  fs.writeFileSync(path.join(source, 'Dockerfile'), 'FROM scratch\n');
  for (const name of ['http.conf', 'https.conf']) fs.writeFileSync(path.join(source, 'deploy', 'nginx', name), '# test template __HTTPS_PORT_SUFFIX__\n');
  const log = path.join(root, 'calls.jsonl'); fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({a, cwd:process.cwd(), database:process.env.DATABASE_URL})+'\\n');
if (a[0] === 'pull') {
  if (process.env.MOCK_FAIL_PULL && a.join(' ').includes(process.env.MOCK_FAIL_PULL)) process.exit(1);
} else if (a[0] === 'ps') console.log(process.env.MOCK_OWNER_DIR || '');
else if (a[0] === 'image' && a[1] === 'inspect') {
  const image = a.at(-1), migrate = image.includes('migrate');
  if (a.some(x => x.includes('.RepoDigests'))) console.log(image.slice(0,image.lastIndexOf(':')) + '@sha256:' + (migrate?'b':'a').repeat(64));
  else console.log(migrate ? (process.env.MOCK_MIGRATE_REV || '${revision}') : '${revision}');
} else if (a[0] === 'run') {
  if (a.includes('--entrypoint') && a.includes('tar')) process.stdout.write(require('zlib').gzipSync(Buffer.alloc(1024)));
} else if (a[0] === 'inspect') {
  const template = a[2] || '';
  if (template.includes('.Mounts')) console.log(template.includes('/app/storage') ? 'custom_storage-data' : 'custom_db-data');
  else if (template.includes('.Image')) console.log('sha256:local-image');
  else console.log(a.at(-1)==='web-id' ? (process.env.MOCK_WEB_STATE || 'running healthy') : 'running healthy');
} else if (a[0] === 'compose') {
  const args = a.slice(1);
  for (const flag of ['--project-directory', '--env-file']) { const i=args.indexOf(flag); if(i>=0) args.splice(i,2); }
  if (args[0] === 'version') console.log(process.env.MOCK_COMPOSE_VERSION || '2.29.0');
  else if (args[0] === 'ps' && args.includes('-q')) console.log(args.at(-1)+'-id');
  else if (args[0] === 'config' && args.includes('--services')) console.log('app\\nweb\\nmigrate\\npostgres\\ndb-tools');
  else if (args[0] === 'config' && process.env.MOCK_BAD_CONFIG) process.exit(1);
  else if (args[0] === 'exec' && args.includes('pg_dump')) { if(process.env.MOCK_FAIL_BACKUP) process.exit(1); process.stdout.write('fake database dump'); }
  else if (args[0] === 'logs' && process.env.MOCK_BANNER) console.log('migrate-1 | ======================================================================\\nmigrate-1 | test-only credentials\\nmigrate-1 | ======================================================================');
  else if (args[0] === 'up' && process.env.MOCK_FAIL_UP) process.exit(1);
}
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), a=process.argv.slice(2);
const url=a.find(x=>x.startsWith('https://')), out=a[a.indexOf('-o')+1];
if (process.env.MOCK_FAIL_DOWNLOAD && url.includes(process.env.MOCK_FAIL_DOWNLOAD)) process.exit(22);
fs.copyFileSync(path.join(process.env.MOCK_SOURCE, 'deploy', url.split('/deploy/')[1]), out);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, MOCK_LOG: log, MOCK_SOURCE: source,
    EVACAL_BIN_DIR: path.join(root, 'commands'), EVACAL_HEALTH_TIMEOUT: '1', EVACAL_DIR: '', EVACAL_TAG: '', EVACAL_DOMAIN: '' };
  const run=(args, extra={}, script=installer, withDir=true) => spawnSync('bash',[script,...args,...(withDir?['--dir',dir]:[])],
    {env:{...env,...extra},encoding:'utf8',timeout:20000,cwd:root});
  const calls=()=>fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const ok=r=>assert.equal(r.status,0,r.stderr || r.stdout || r.error?.message);
  function value(key) {
    const r=spawnSync('bash',['-c','source "$1"; INSTALL_DIR="$2"; env_get "$3"','test',installer,dir,key],{env,encoding:'utf8'});
    ok(r); return r.stdout;
  }
  return {root,dir,source,env,run,calls,value,ok,clear:()=>fs.writeFileSync(log,'')};
}

test('help needs no Docker and creates no installation', t=>{
  const f=fixture(t); f.ok(f.run(['--help'])); assert.equal(fs.existsSync(f.dir),false); assert.equal(f.calls().length,0);
});
for (const args of [['--version'],['--sqlite','--database-url','postgresql://db/test'],['--cert','missing'],['typo']]) {
  test(`bad arguments fail before Docker: ${args.join(' ')}`, t=>{
    const f=fixture(t), r=f.run(args,{},installer,false); assert.notEqual(r.status,0);
    assert.doesNotMatch(r.stderr,/unbound variable/); assert.equal(f.calls().length,0);
  });
}
test('dotenv literals round-trip without execution and are mode 600', t=>{
  const f=fixture(t); fs.mkdirSync(f.dir);
  const value='space #hash $HOME ${FOO} $(touch should-not-exist) \'quote" and \\backslash\\';
  const r=spawnSync('bash',['-c','source "$1"; INSTALL_DIR="$2"; env_set DATABASE_URL "$VALUE"; env_get DATABASE_URL','test',installer,f.dir],
    {env:{...f.env,VALUE:value},encoding:'utf8',cwd:f.root});
  f.ok(r); assert.equal(r.stdout,value); assert.equal(fs.statSync(path.join(f.dir,'.env')).mode&0o777,0o600);
  assert.equal(fs.existsSync(path.join(f.root,'should-not-exist')),false);
});
test('local install pins digests, preserves secrets and resolves its symlink', t=>{
  const f=fixture(t); f.ok(f.run(['install','--local','--version','v1.2.3','--yes'],{MOCK_BANNER:'1'}));
  assert.equal(f.value('EVACAL_TAG'),'1.2.3'); assert.equal(f.value('EVACAL_BIND_ADDRESS'),'127.0.0.1');
  assert.equal(f.value('EVACAL_HTTP_PORT'),'8080'); assert.equal(f.value('FORCE_SECURE_COOKIES'),'false');
  assert.match(f.value('EVACAL_APP_REF'),/@sha256:a{64}$/); assert.match(f.value('EVACAL_MIGRATE_REF'),/@sha256:b{64}$/);
  assert.equal(f.value('EVACAL_CONFIG_REF'),revision); assert.match(f.value('COMPOSE_FILE'),/postgres/); assert.doesNotMatch(f.value('COMPOSE_FILE'),/tls/);
  assert.equal(fs.statSync(path.join(f.dir,'credentials.txt')).mode&0o777,0o600);
  const secret=f.value('SESSION_SECRET'), password=f.value('POSTGRES_PASSWORD'); f.ok(f.run(['install','--yes']));
  assert.equal(f.value('SESSION_SECRET'),secret); assert.equal(f.value('POSTGRES_PASSWORD'),password);
  const link=path.join(f.root,'commands','evacal'); assert.equal(fs.lstatSync(link).isSymbolicLink(),true);
  f.clear(); f.ok(f.run(['status'],{},link,false));
  assert.ok(f.calls().filter(x=>x.a[0]==='compose'&&!x.a.includes('version')).every(x=>x.a.includes(f.dir)));
});
for (const [label,extra] of [['pull',{MOCK_FAIL_PULL:'evacal-migrate:1.2.4'}],['download',{MOCK_FAIL_DOWNLOAD:'docker-compose.tls.yml'}],
  ['mismatched revisions',{MOCK_MIGRATE_REV:'2'.repeat(40)}],['bad compose',{MOCK_BAD_CONFIG:'1'}]]) {
  test(`failed ${label} preserves live files and never stops services`, t=>{
    const f=fixture(t); f.ok(f.run(['install','--local','--version','1.2.3','--yes']));
    const before=fs.readFileSync(path.join(f.dir,'.env'),'utf8'), script=fs.readFileSync(path.join(f.dir,'evacal'),'utf8'); f.clear();
    assert.notEqual(f.run(['update','--version','1.2.4','--yes'],extra).status,0);
    assert.equal(fs.readFileSync(path.join(f.dir,'.env'),'utf8'),before); assert.equal(fs.readFileSync(path.join(f.dir,'evacal'),'utf8'),script);
    assert.equal(f.calls().some(x=>x.a.includes('stop')||x.a.includes('up')||x.a.includes('rm')),false);
    assert.equal(fs.readdirSync(f.dir).some(x=>x.startsWith('.prepare.')),false);
  });
}
test('external PostgreSQL needs no local database and preserves dollars', t=>{
  const f=fixture(t), url='postgresql://user:p$WORD%23@database:5432/evacal';
  f.ok(f.run(['install','--local','--database-url',url,'--yes'])); assert.equal(f.value('DATABASE_URL'),url); assert.doesNotMatch(f.value('COMPOSE_FILE'),/postgres/);
});
test('SQLite source install uses data-only paths and never pulls GHCR', t=>{
  const f=fixture(t); f.ok(f.run(['install','--local','--source',f.source,'--sqlite','--yes']));
  assert.equal(f.value('DATABASE_URL'),'file:/app/data/dev.db'); assert.doesNotMatch(f.value('COMPOSE_FILE'),/postgres/); assert.match(f.value('COMPOSE_FILE'),/build/);
  assert.equal(f.calls().some(x=>x.a[0]==='pull'),false); assert.ok(f.calls().some(x=>x.a.includes('build')));
});
test('bad ports and Compose v1 do not commit configuration', t=>{
  const f=fixture(t); assert.notEqual(f.run(['install','--local','--http-port','70000']).status,0); assert.equal(fs.existsSync(path.join(f.dir,'.env')),false);
  assert.notEqual(f.run(['install','--local'],{MOCK_COMPOSE_VERSION:'1.29.2'}).status,0);
});
test('another installation using the project name is not touched', t=>{
  const f=fixture(t); assert.notEqual(f.run(['install','--local'],{MOCK_OWNER_DIR:'/different/installation'}).status,0);
  assert.equal(f.calls().some(x=>x.a.includes('stop')||x.a.includes('up')),false);
});
test('unhealthy web is not a successful install', t=>{
  const f=fixture(t), r=f.run(['install','--local'],{MOCK_WEB_STATE:'exited unhealthy'});
  assert.notEqual(r.status,0); assert.match(r.stderr,/готовности app и web/);
});
test('saved configuration overrides exported developer settings', t=>{
  const f=fixture(t); f.ok(f.run(['install','--local'],{DATABASE_URL:'file:wrong.db'}));
  assert.ok(f.calls().filter(x=>x.a[0]==='compose'&&!x.a.includes('version')).every(x=>x.database===undefined));
});
test('purge requires confirmation and never removes shared images', t=>{
  const f=fixture(t); f.ok(f.run(['install','--local'])); f.clear();
  assert.notEqual(f.run(['uninstall','--purge']).status,0); assert.equal(fs.existsSync(f.dir),true);
  f.ok(f.run(['uninstall','--purge','--yes'])); assert.equal(fs.existsSync(f.dir),false);
  assert.equal(f.calls().some(x=>x.a.includes('prune')||x.a.includes('--rmi')),false);
});
test('archive traversal is rejected before extraction', t=>{
  const f=fixture(t), file=path.join(f.root,'malicious.tar.gz'), header=Buffer.alloc(512);
  header.write('../escape'); header.write('0000600\0',100); header.write('0000000\0',108); header.write('0000000\0',116);
  header.write('00000000000\0',124); header.write('00000000000\0',136); header.fill(32,148,156); header[156]=48;
  header.write(header.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
  const zipped=spawnSync('gzip',['-c'],{input:Buffer.concat([header,Buffer.alloc(1024)])}); assert.equal(zipped.status,0); fs.writeFileSync(file,zipped.stdout);
  const r=spawnSync('bash',['-c','source "$1"; validate_archive "$2"','test',installer,file],{encoding:'utf8'});
  assert.notEqual(r.status,0); assert.match(r.stderr,/Небезопасные пути/);
});


test('update backs up before migration, keeps the selected tag and never prunes images', t=>{
  const f=fixture(t); f.ok(f.run(['install','--local','--version','1.2.3'])); f.clear();
  f.ok(f.run(['update','--yes'])); assert.equal(f.value('EVACAL_TAG'),'1.2.3');
  const files=fs.readdirSync(path.join(f.dir,'backups')).filter(x=>x.endsWith('.tar.gz'));
  assert.equal(files.length,1); assert.equal(fs.statSync(path.join(f.dir,'backups',files[0])).mode&0o777,0o600);
  const calls=f.calls(), dump=calls.findIndex(x=>x.a.includes('pg_dump')), migrate=calls.findIndex(x=>x.a.includes('rm')&&x.a.includes('migrate'));
  assert.ok(dump>=0 && migrate>dump); assert.equal(calls.some(x=>x.a.includes('prune')),false);
  assert.ok(calls.some(x=>x.a.some(v=>v.includes('source=custom_storage-data'))));
});

test('failed backup aborts update before replacing live configuration', t=>{
  const f=fixture(t); f.ok(f.run(['install','--local','--version','1.2.3']));
  const before=fs.readFileSync(path.join(f.dir,'.env'),'utf8'); f.clear();
  assert.notEqual(f.run(['update','--version','1.2.4'],{MOCK_FAIL_BACKUP:'1'}).status,0);
  assert.equal(fs.readFileSync(path.join(f.dir,'.env'),'utf8'),before);
  assert.equal(f.calls().some(x=>x.a.includes('rm')&&x.a.includes('migrate')),false);
});
