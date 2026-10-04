import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Fast contract; real build-context and image checks run in the manual CI job.
const rules = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim());

for (const pattern of ['**/*.sqlite', '**/*.sqlite-*', '**/*.db', '**/*.db-*']) {
  test(`Docker context keeps the data exclusion ${pattern}`, () => {
    assert.ok(rules.includes(pattern), `Missing data exclusion: ${pattern}`);
  });
}
