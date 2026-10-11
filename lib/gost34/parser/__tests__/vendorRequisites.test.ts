import { describe, it, expect } from 'vitest';
import { extractVendorRequisites } from '../vendorDocParser';

describe('extractVendorRequisites', () => {
  it('извлекает сертификаты ФСТЭК, ФСБ и записи реестра как кандидаты без статического справочника', () => {
    const found = extractVendorRequisites(`
      Операционная система Astra Linux Special Edition.
      Соответствие подтверждено сертификатом ФСТЭК России № 2557 (1 уровень доверия).
      Продукт включён в Единый реестр российского ПО, запись № 369.
      СКЗИ сертифицировано ФСБ России, сертификат № СФ/124-4900 (класс КС3).
    `);
    expect(found.map((r) => [r.kind, r.number])).toEqual([
      ['fstek', '№ 2557'],
      ['fsb', '№ СФ/124-4900'],
      ['reestr-min-tsifry', '№ 369'],
    ]);
    // Никакой привязки к «известным» продуктам: номер — только кандидат для ручной проверки.
    for (const r of found) expect(Object.keys(r).sort()).toEqual(['context', 'kind', 'number']);
  });

  it('не дублирует одинаковые находки и терпит пустой текст', () => {
    const found = extractVendorRequisites(
      'сертификат ФСТЭК № 4063. Повторно: сертификат ФСТЭК России № 4063.',
    );
    expect(found).toHaveLength(1);
    expect(extractVendorRequisites('')).toEqual([]);
  });
});
