import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_STORAGE_DIR = 'storage/gost-packages';

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

export interface StoredArtifactInfo {
  artifactPath: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * Persists an immutable ZIP artifact to disk and computes its SHA-256 hash.
 */
export async function storePackageArtifact(
  projectId: string,
  packageId: string,
  buffer: Buffer | Uint8Array,
): Promise<StoredArtifactInfo> {
  const baseDir = getPackageStorageDir();
  const safeProject = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePackage = packageId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const projectDir = path.join(baseDir, safeProject);
  await fs.mkdir(projectDir, { recursive: true });

  const relativePath = path.join(safeProject, `${safePackage}.zip`);
  const absolutePath = path.join(baseDir, relativePath);

  await fs.writeFile(absolutePath, buffer);

  const checksum = calculateChecksum(buffer);

  return {
    artifactPath: relativePath,
    checksum,
    sizeBytes: buffer.length,
  };
}

/**
 * Reads an artifact from disk given its stored relative path, validating integrity.
 */
export async function loadPackageArtifact(
  artifactPath: string,
): Promise<{ buffer: Buffer; checksum: string } | null> {
  if (!artifactPath || typeof artifactPath !== 'string') return null;

  const baseDir = getPackageStorageDir();
  const resolvedPath = path.resolve(baseDir, artifactPath);

  // Security guard against directory traversal
  const rel = path.relative(baseDir, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal attempt in artifact path');
  }

  try {
    const buffer = await fs.readFile(resolvedPath);
    const checksum = calculateChecksum(buffer);
    return { buffer, checksum };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
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
  const baseDir = getPackageStorageDir();
  const safeProject = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePackage = packageId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const projectDir = path.join(baseDir, safeProject);
  await fs.mkdir(projectDir, { recursive: true });

  const relativePath = path.join(safeProject, `${safePackage}-tw.docx`);
  await fs.writeFile(path.join(baseDir, relativePath), buffer);

  return {
    artifactPath: relativePath,
    checksum: calculateChecksum(buffer),
    sizeBytes: buffer.length,
  };
}

/**
 * Читает произвольный файл из хранилища комплектов по относительному пути.
 * Тот же traversal-guard, что и у `loadPackageArtifact`.
 */
export async function loadStoredFile(
  relativePath: string,
): Promise<{ buffer: Buffer; checksum: string } | null> {
  return loadPackageArtifact(relativePath);
}
