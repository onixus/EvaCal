/**
 * Обновление эталонов контрольных документов:
 *
 *     npx tsx lib/gost34/__tests__/golden/update.ts
 *
 * Запускать осознанно: изменение эталона означает, что структура выпускаемого
 * документа действительно изменилась, и это изменение должно быть видно в ревью.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_SCENARIOS } from './scenarios';
import { buildGoldenSnapshot } from './snapshot';

for (const scenario of GOLDEN_SCENARIOS) {
  const target = join(__dirname, `${scenario.id}.json`);
  writeFileSync(target, `${JSON.stringify(buildGoldenSnapshot(scenario), null, 2)}\n`, 'utf8');
  console.log(`updated ${scenario.id}.json`);
}
