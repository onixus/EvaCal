import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  calculateChecksum,
  storePackageArtifact,
  loadPackageArtifact,
  getPackageStorageDir,
} from '../storage';

describe('GOST 34 Artifact Storage & SHA-256 Checksum', () => {
  const testDir = path.resolve(process.cwd(), 'tmp-test-storage');

  beforeEach(async () => {
    process.env.GOST_PACKAGE_STORAGE_PATH = testDir;
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.GOST_PACKAGE_STORAGE_PATH;
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
});
