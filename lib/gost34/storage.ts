import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

/**
 * Хранилище неизменяемых артефактов комплектов ГОСТ 34 (ZIP выпуска и DOCX
 * тех.писателя).
 *
 * Два бэкенда за одним интерфейсом:
 *  - `fs` — каталог на диске (GOST_PACKAGE_STORAGE_PATH, по умолчанию
 *    storage/gost-packages). Режим одного стенда: в Docker каталог должен быть
 *    томом, иначе артефакты исчезнут вместе с контейнером.
 *  - `s3` — S3-совместимое объектное хранилище (AWS S3, MinIO, Яндекс/VK
 *    Object Storage, Ceph RGW). Единственный вариант для нескольких реплик
 *    приложения и централизованных бэкапов.
 *
 * В базе (GostPackage.artifactPath / twVersionPath) лежит относительный ключ
 * вида `<project>/<package>.zip` — одинаковый для обоих бэкендов, поэтому
 * переключение не требует миграции строк, только переноса самих файлов.
 *
 * Выбор: GOST_PACKAGE_STORAGE=fs|s3; если не задан — s3 при заданном
 * S3_BUCKET, иначе fs.
 */

const DEFAULT_STORAGE_DIR = 'storage/gost-packages';

export type ArtifactStorageKind = 'fs' | 's3';

export interface ArtifactBackend {
  readonly kind: ArtifactStorageKind;
  put(key: string, buffer: Buffer | Uint8Array): Promise<void>;
  /** null — объекта нет. */
  get(key: string): Promise<Buffer | null>;
}

export interface StoredArtifactInfo {
  artifactPath: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * Returns the resolved base storage directory for GOST 34 package artifacts.
 */
export function getPackageStorageDir(): string {
  const custom = process.env.GOST_PACKAGE_STORAGE_PATH?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.resolve(process.cwd(), custom);
  }
  return path.resolve(process.cwd(), DEFAULT_STORAGE_DIR);
}

/**
 * Calculates SHA-256 checksum for a binary buffer.
 */
export function calculateChecksum(buffer: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeSegment(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Проверяет ключ из базы: относительный, без `..`, с прямыми слэшами.
 * Один guard на оба бэкенда — в S3 traversal не страшен, но ключ с `..`
 * всё равно означает подделанную запись, и читать по нему нельзя.
 */
function assertSafeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((seg) => seg === '..' || seg === '')
  ) {
    throw new Error('Path traversal attempt in artifact path');
  }
  return normalized;
}

// ---------------------------------------------------------------- fs backend

function createFsBackend(): ArtifactBackend {
  return {
    kind: 'fs',
    async put(key, buffer) {
      const baseDir = getPackageStorageDir();
      const absolutePath = path.join(baseDir, ...key.split('/'));
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, buffer);
    },
    async get(key) {
      const baseDir = getPackageStorageDir();
      const resolvedPath = path.resolve(baseDir, key);
      // Security guard against directory traversal
      const rel = path.relative(baseDir, resolvedPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('Path traversal attempt in artifact path');
      }
      try {
        return await fs.readFile(resolvedPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------- s3 backend

export interface S3StorageOptions {
  bucket: string;
  /** Префикс ключей внутри бакета (например, `evacal/prod`). */
  prefix?: string;
}

/** Минимум от S3Client, который нужен бэкенду: тесты подставляют заглушку. */
export type S3ClientLike = Pick<S3Client, 'send'>;

export function readS3ConfigFromEnv(env: Record<string, string | undefined> = process.env): {
  client: S3ClientConfig;
  options: S3StorageOptions;
} {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) throw new Error('GOST_PACKAGE_STORAGE=s3, но S3_BUCKET не задан');
  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  const forcePathStyleRaw = env.S3_FORCE_PATH_STYLE?.trim().toLowerCase();
  return {
    client: {
      region: env.S3_REGION?.trim() || 'us-east-1',
      endpoint,
      // MinIO и большинство self-hosted S3 живут на path-style адресах
      // (host/bucket/key), virtual-host (bucket.host) требует DNS-магии.
      forcePathStyle: forcePathStyleRaw
        ? forcePathStyleRaw === 'true' || forcePathStyleRaw === '1'
        : Boolean(endpoint),
      // Без ключей SDK идёт по стандартной цепочке (IAM-роль, профиль, env AWS_*).
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    },
    options: { bucket, prefix: env.S3_PREFIX?.trim().replace(/^\/+|\/+$/g, '') || undefined },
  };
}

export function createS3Backend(client: S3ClientLike, options: S3StorageOptions): ArtifactBackend {
  const fullKey = (key: string) => (options.prefix ? `${options.prefix}/${key}` : key);
  return {
    kind: 's3',
    async put(key, buffer) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: fullKey(key),
          Body: buffer,
          ContentLength: buffer.length,
          // Контрольная сумма считается и здесь, и при чтении; SDK сверит
          // её с тем, что сохранил сервер.
          ChecksumSHA256: Buffer.from(calculateChecksum(buffer), 'hex').toString('base64'),
        }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: fullKey(key) }),
        );
        if (!res.Body) return null;
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (err) {
        const name = (err as { name?: string }).name;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) return null;
        throw err;
      }
    },
  };
}

/** Проверяет доступность бакета (для health-check и старта контейнера). */
export async function checkS3Bucket(client: S3ClientLike, bucket: string): Promise<void> {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
}

// ---------------------------------------------------------------- selection

export function resolveArtifactStorageKind(
  env: Record<string, string | undefined> = process.env,
): ArtifactStorageKind {
  const explicit = env.GOST_PACKAGE_STORAGE?.trim().toLowerCase();
  if (explicit === 'fs' || explicit === 's3') return explicit;
  if (explicit)
    throw new Error(`GOST_PACKAGE_STORAGE=${explicit} не поддерживается: допустимы fs, s3`);
  return env.S3_BUCKET?.trim() ? 's3' : 'fs';
}

let cachedBackend: ArtifactBackend | null = null;

function getBackend(): ArtifactBackend {
  if (cachedBackend) return cachedBackend;
  if (resolveArtifactStorageKind() === 's3') {
    const { client, options } = readS3ConfigFromEnv();
    cachedBackend = createS3Backend(new S3Client(client), options);
  } else {
    cachedBackend = createFsBackend();
  }
  return cachedBackend;
}

/** Подменить бэкенд (тесты) или сбросить кэш после смены окружения. */
export function setArtifactBackend(backend: ArtifactBackend | null): void {
  cachedBackend = backend;
}

export function currentArtifactStorageKind(): ArtifactStorageKind {
  return getBackend().kind;
}

// ---------------------------------------------------------------- public API

async function storeFile(
  projectId: string,
  packageId: string,
  suffix: string,
  buffer: Buffer | Uint8Array,
): Promise<StoredArtifactInfo> {
  const key = `${safeSegment(projectId)}/${safeSegment(packageId)}${suffix}`;
  await getBackend().put(key, buffer);
  return { artifactPath: key, checksum: calculateChecksum(buffer), sizeBytes: buffer.length };
}

/**
 * Persists an immutable ZIP artifact and computes its SHA-256 hash.
 */
export async function storePackageArtifact(
  projectId: string,
  packageId: string,
  buffer: Buffer | Uint8Array,
): Promise<StoredArtifactInfo> {
  return storeFile(projectId, packageId, '.zip', buffer);
}

/**
 * Reads an artifact given its stored relative key, validating integrity.
 */
export async function loadPackageArtifact(
  artifactPath: string,
): Promise<{ buffer: Buffer; checksum: string } | null> {
  if (!artifactPath || typeof artifactPath !== 'string') return null;
  const buffer = await getBackend().get(assertSafeKey(artifactPath));
  if (!buffer) return null;
  return { buffer, checksum: calculateChecksum(buffer) };
}

/**
 * Сохраняет DOCX, загруженный тех.писателем, рядом с артефактом комплекта.
 *
 * Хранится отдельным файлом, а не поверх ZIP: сгенерированный комплект
 * неизменяем и остаётся доказательством того, что выпустила студия, а
 * правленая версия — приоритетный, но отдельный документ.
 */
export async function storeTechWriterVersion(
  projectId: string,
  packageId: string,
  buffer: Buffer | Uint8Array,
): Promise<StoredArtifactInfo> {
  return storeFile(projectId, packageId, '-tw.docx', buffer);
}

/**
 * Читает произвольный файл из хранилища комплектов по относительному ключу.
 * Тот же traversal-guard, что и у `loadPackageArtifact`.
 */
export async function loadStoredFile(
  relativePath: string,
): Promise<{ buffer: Buffer; checksum: string } | null> {
  return loadPackageArtifact(relativePath);
}
