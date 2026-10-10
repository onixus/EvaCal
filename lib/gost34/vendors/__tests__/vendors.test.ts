import { describe, it, expect } from 'vitest';
import { VENDOR_SOFTWARE } from '../registry';

describe('База знаний вендоров РФ', () => {
  it('не содержит дубликатов идентификаторов', () => {
    const ids = VENDOR_SOFTWARE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('каждый номер реестра/сертификата подтверждён источником', () => {
    for (const p of VENDOR_SOFTWARE) {
      const hasNumber = /№ ?\d/.test(`${p.reestrMinTsifry || ''} ${p.certification || ''}`);
      if (hasNumber) {
        expect(p.sourceUrl, `${p.id}: номер без ссылки на источник`).toBeTruthy();
      }
    }
  });
});
