import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  calculateChecksum,
  storePackageArtifact,
  loadPackageArtifact,
  storeTechWriterVersion,
  loadStoredFile,
  setArtifactBackend,
  createS3Backend,
  resolveArtifactStorageKind,
  readS3ConfigFromEnv,
  type S3ClientLike,
} from '../storage';

describe('GOST 34 Artifact Storage & SHA-256 Checksum', () => {
  const testDir = path.resolve(process.cwd(), 'tmp-test-storage');

  beforeEach(async () => {
    process.env.GOST_PACKAGE_STORAGE_PATH = testDir;
    delete process.env.S3_BUCKET;
    delete process.env.GOST_PACKAGE_STORAGE;
    setArtifactBackend(null);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.GOST_PACKAGE_STORAGE_PATH;
    setArtifactBackend(null);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('calculates deterministic SHA-256 checksum for byte buffers', () => {
    const data = Buffer.from('GOST 34.602-2020 Standard Document Content');
    const hash1 = calculateChecksum(data);
    const hash2 = calculateChecksum(data);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
    expect(hash1).toBe('120704e847b2f0dc3e8fa2646f5ab318262306322095856042d71074140bafa6');
  });

  it('stores and reloads an immutable package artifact', async () => {
    const projectId = 'prj-test-123';
    const packageId = 'pkg-test-456';
    const zipBytes = Buffer.from('PK\x03\x04fake-zip-archive-content-for-gost34');

    const stored = await storePackageArtifact(projectId, packageId, zipBytes);
    expect(stored.artifactPath).toContain(projectId);
    expect(stored.checksum).toBe(calculateChecksum(zipBytes));
    expect(stored.sizeBytes).toBe(zipBytes.length);

    const loaded = await loadPackageArtifact(stored.artifactPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.buffer.toString()).toBe(zipBytes.toString());
    expect(loaded!.checksum).toBe(stored.checksum);
  });

  it('returns null when artifact file does not exist', async () => {
    const loaded = await loadPackageArtifact('non-existent-dir/missing.zip');
    expect(loaded).toBeNull();
  });

  it('prevents path traversal attempts', async () => {
    await expect(loadPackageArtifact('../../../etc/passwd')).rejects.toThrow();
  });

  it('stores the file on disk under the returned relative key', async () => {
    const stored = await storePackageArtifact('prj', 'pkg', Buffer.from('x'));
    expect(stored.artifactPath).toBe('prj/pkg.zip');
    await expect(fs.stat(path.join(testDir, 'prj', 'pkg.zip'))).resolves.toBeTruthy();
  });
});

/**
 * S3-бэкенд на заглушке клиента: проверяется протокол (какие команды, с какими
 * ключами и телом), а не сам SDK. Живое хранилище — MinIO — гоняется вручную
 * (см. README, «Хранилище артефактов»).
 */
describe('GOST 34 Artifact Storage: S3 backend', () => {
  function fakeS3(): { client: S3ClientLike; objects: Map<string, Buffer> } {
    const objects = new Map<string, Buffer>();
    const client = {
      send: async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand) {
          const { Bucket, Key, Body } = cmd.input;
          objects.set(`${Bucket}/${Key}`, Buffer.from(Body as Uint8Array));
          return {};
        }
        if (cmd instanceof GetObjectCommand) {
          const { Bucket, Key } = cmd.input;
          const body = objects.get(`${Bucket}/${Key}`);
          if (!body) {
            const err = new Error('NoSuchKey') as Error & { name: string; $metadata: unknown };
            err.name = 'NoSuchKey';
            err.$metadata = { httpStatusCode: 404 };
            throw err;
          }
          return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
        }
        throw new Error(`unexpected command ${String(cmd)}`);
      },
    } as unknown as S3ClientLike;
    return { client, objects };
  }

  beforeEach(() => setArtifactBackend(null));
  afterEach(() => setArtifactBackend(null));

  it('пишет и читает объект под тем же ключом, что и файловый бэкенд', async () => {
    const { client, objects } = fakeS3();
    setArtifactBackend(createS3Backend(client, { bucket: 'evacal', prefix: 'prod' }));
    const zip = Buffer.from('PK\x03\x04zip');

    const stored = await storePackageArtifact('prj-1', 'pkg-1', zip);
    expect(stored.artifactPath).toBe('prj-1/pkg-1.zip');
    expect(stored.checksum).toBe(calculateChecksum(zip));
    expect([...objects.keys()]).toEqual(['evacal/prod/prj-1/pkg-1.zip']);

    const loaded = await loadPackageArtifact(stored.artifactPath);
    expect(loaded?.buffer.equals(zip)).toBe(true);
    expect(loaded?.checksum).toBe(stored.checksum);

    const tw = await storeTechWriterVersion('prj-1', 'pkg-1', Buffer.from('docx'));
    expect(tw.artifactPath).toBe('prj-1/pkg-1-tw.docx');
    expect((await loadStoredFile(tw.artifactPath))?.buffer.toString()).toBe('docx');
  });

  it('отсутствующий объект — null, а не исключение', async () => {
    setArtifactBackend(createS3Backend(fakeS3().client, { bucket: 'b' }));
    expect(await loadPackageArtifact('prj/missing.zip')).toBeNull();
  });

  it('не читает по подделанному ключу с ..', async () => {
    setArtifactBackend(createS3Backend(fakeS3().client, { bucket: 'b' }));
    await expect(loadPackageArtifact('../other/pkg.zip')).rejects.toThrow('Path traversal');
    await expect(loadPackageArtifact('/abs/pkg.zip')).rejects.toThrow('Path traversal');
  });

  it('выбирает бэкенд по окружению', () => {
    expect(resolveArtifactStorageKind({})).toBe('fs');
    expect(resolveArtifactStorageKind({ S3_BUCKET: 'b' })).toBe('s3');
    expect(resolveArtifactStorageKind({ S3_BUCKET: 'b', GOST_PACKAGE_STORAGE: 'fs' })).toBe('fs');
    expect(() => resolveArtifactStorageKind({ GOST_PACKAGE_STORAGE: 'gcs' })).toThrow();
  });

  it('собирает конфиг S3 из переменных: path-style по умолчанию при своём endpoint', () => {
    const cfg = readS3ConfigFromEnv({
      S3_BUCKET: 'evacal',
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      S3_PREFIX: '/prod/',
    });
    expect(cfg.client.forcePathStyle).toBe(true);
    expect(cfg.client.endpoint).toBe('http://minio:9000');
    expect(cfg.options).toEqual({ bucket: 'evacal', prefix: 'prod' });
    expect(() => readS3ConfigFromEnv({})).toThrow('S3_BUCKET');
  });
});
