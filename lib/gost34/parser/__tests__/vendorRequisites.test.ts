import { describe, it, expect } from 'vitest';
import { extractVendorRequisites } from '../vendorDocParser';

describe('extractVendorRequisites', () => {
  it('извлекает сертификаты ФСТЭК, ФСБ и записи реестра из текста формуляра', () => {
    const text = `
      Операционная система Astra Linux Special Edition.
      Соответствие подтверждено сертификатом ФСТЭК России № 2557 (1 уровень доверия).
      Продукт включён в Единый реестр российского ПО, запись № 369.
      СКЗИ сертифицировано ФСБ России, сертификат № СФ/124-4900 (класс КС3).
    `;
    const found = extractVendorRequisites(text);

    const fstek = found.find((r) => r.kind === 'fstek');
    expect(fstek?.number).toBe('№ 2557');
    expect(fstek?.matchesKnownProductId).toBe('astra-linux-se');

    const reestr = found.find((r) => r.kind === 'reestr-min-tsifry');
    expect(reestr?.number).toBe('№ 369');
    expect(reestr?.matchesKnownProductId).toBe('astra-linux-se');

    const fsb = found.find((r) => r.kind === 'fsb');
    expect(fsb?.number).toBe('№ СФ/124-4900');
    expect(fsb?.matchesKnownProductId).toBe('vipnet');
  });

  it('незнакомый номер остаётся без привязки к базе — сигнал к сверке', () => {
    const found = extractVendorRequisites('Сертификат ФСТЭК России № 9999 на изделие.');
    expect(found).toHaveLength(1);
    expect(found[0].matchesKnownProductId).toBeUndefined();
  });

  it('не дублирует одинаковые находки и терпит пустой текст', () => {
    const found = extractVendorRequisites(
      'сертификат ФСТЭК № 4063. Повторно: сертификат ФСТЭК России № 4063.',
    );
    expect(found).toHaveLength(1);
    expect(extractVendorRequisites('')).toEqual([]);
  });
});
